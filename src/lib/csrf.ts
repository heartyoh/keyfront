import { NextRequest, NextResponse } from 'next/server';
import { redisService } from '@/services/redis';
import { generateTraceId } from './tracing';
import { UserSession } from '@/types/auth';
import crypto from 'crypto';

export interface CsrfConfig {
  secret: string;
  tokenLength: number;
  cookieName: string;
  headerName: string;
  excludeMethods: string[];
  sameSite: 'strict' | 'lax' | 'none';
  secure: boolean;
  httpOnly: boolean;
  maxAge: number; // seconds
}

export interface CsrfTokenInfo {
  token: string;
  hash: string;
  expiresAt: number;
  sessionId: string;
  userId?: string;
  tenantId?: string;
}

export class CsrfProtection {
  private config: CsrfConfig;

  constructor(config: Partial<CsrfConfig> = {}) {
    this.config = {
      secret: process.env.CSRF_SECRET || process.env.SESSION_SECRET || 'csrf-secret-change-in-production',
      tokenLength: 32,
      cookieName: 'keyfront.csrf',
      headerName: 'x-csrf-token',
      excludeMethods: ['GET', 'HEAD', 'OPTIONS'],
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      httpOnly: false, // Must be false for client-side access
      maxAge: 3600, // 1 hour
      ...config,
    };

    if (this.config.secret.length < 32) {
      console.warn('CSRF secret should be at least 32 characters long');
    }
  }

  /**
   * Generate a cryptographically secure CSRF token
   */
  private generateToken(): string {
    return crypto.randomBytes(this.config.tokenLength).toString('hex');
  }

  /**
   * Create HMAC hash of token for verification
   */
  private createTokenHash(token: string, sessionId: string): string {
    const hmac = crypto.createHmac('sha256', this.config.secret);
    hmac.update(token + sessionId);
    return hmac.digest('hex');
  }

  /**
   * Verify CSRF token hash
   */
  private verifyTokenHash(token: string, hash: string, sessionId: string): boolean {
    const expectedHash = this.createTokenHash(token, sessionId);
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expectedHash, 'hex'));
  }

  /**
   * Generate new CSRF token for a session
   */
  async generateCsrfToken(
    sessionId: string, 
    user?: UserSession,
    traceId?: string
  ): Promise<CsrfTokenInfo> {
    const token = this.generateToken();
    const hash = this.createTokenHash(token, sessionId);
    const expiresAt = Date.now() + (this.config.maxAge * 1000);

    const tokenInfo: CsrfTokenInfo = {
      token,
      hash,
      expiresAt,
      sessionId,
      userId: user?.sub,
      tenantId: user?.tenantId,
    };

    // Store token info in Redis
    const redisKey = `csrf:${sessionId}:${token}`;
    await redisService.set(redisKey, JSON.stringify(tokenInfo), this.config.maxAge);

    return tokenInfo;
  }

  /**
   * Validate CSRF token
   */
  async validateCsrfToken(
    token: string,
    sessionId: string,
    traceId?: string
  ): Promise<{ valid: boolean; reason?: string; tokenInfo?: CsrfTokenInfo }> {
    if (!token || !sessionId) {
      return { valid: false, reason: 'Missing token or session' };
    }

    try {
      // Get token info from Redis
      const redisKey = `csrf:${sessionId}:${token}`;
      const tokenData = await redisService.get(redisKey);

      if (!tokenData) {
        return { valid: false, reason: 'Token not found or expired' };
      }

      const tokenInfo: CsrfTokenInfo = JSON.parse(tokenData);

      // Check expiration
      if (tokenInfo.expiresAt < Date.now()) {
        // Clean up expired token
        await redisService.delete(redisKey);
        return { valid: false, reason: 'Token expired' };
      }

      // Verify token hash
      if (!this.verifyTokenHash(token, tokenInfo.hash, sessionId)) {
        return { valid: false, reason: 'Token verification failed' };
      }

      // Verify session matches
      if (tokenInfo.sessionId !== sessionId) {
        return { valid: false, reason: 'Session mismatch' };
      }

      return { valid: true, tokenInfo };
    } catch (error) {
      console.error('CSRF token validation error:', error);
      return { valid: false, reason: 'Validation error' };
    }
  }

  /**
   * Create CSRF cookie
   */
  createCsrfCookie(token: string): string {
    const cookieOptions = [
      `${this.config.cookieName}=${token}`,
      `Max-Age=${this.config.maxAge}`,
      `SameSite=${this.config.sameSite}`,
      'Path=/',
    ];

    if (this.config.secure) {
      cookieOptions.push('Secure');
    }

    if (this.config.httpOnly) {
      cookieOptions.push('HttpOnly');
    }

    return cookieOptions.join('; ');
  }

  /**
   * Extract CSRF token from request
   */
  extractToken(request: NextRequest): string | null {
    // Try header first
    let token = request.headers.get(this.config.headerName);
    
    // Try cookie as fallback
    if (!token) {
      token = request.cookies.get(this.config.cookieName)?.value || null;
    }

    // Try form data for POST requests
    if (!token && request.headers.get('content-type')?.includes('application/x-www-form-urlencoded')) {
      // Note: This would require reading the body, which is complex in middleware
      // Better to rely on header or cookie
    }

    return token;
  }

  /**
   * Check if request method requires CSRF protection
   */
  requiresProtection(method: string): boolean {
    return !this.config.excludeMethods.includes(method.toUpperCase());
  }

  /**
   * Clean up expired tokens for a session
   */
  async cleanupExpiredTokens(sessionId: string): Promise<number> {
    try {
      const pattern = `csrf:${sessionId}:*`;
      const keys = await redisService.getKeysByPattern(pattern);
      let cleaned = 0;

      for (const key of keys) {
        const tokenData = await redisService.get(key);
        if (tokenData) {
          const tokenInfo: CsrfTokenInfo = JSON.parse(tokenData);
          if (tokenInfo.expiresAt < Date.now()) {
            await redisService.delete(key);
            cleaned++;
          }
        }
      }

      return cleaned;
    } catch (error) {
      console.error('Error cleaning up CSRF tokens:', error);
      return 0;
    }
  }

  /**
   * Invalidate all CSRF tokens for a session
   */
  async invalidateSessionTokens(sessionId: string): Promise<number> {
    try {
      const pattern = `csrf:${sessionId}:*`;
      const keys = await redisService.getKeysByPattern(pattern);
      
      if (keys.length > 0) {
        await redisService.deleteMultiple(keys);
      }
      
      return keys.length;
    } catch (error) {
      console.error('Error invalidating CSRF tokens:', error);
      return 0;
    }
  }

  /**
   * Get CSRF token statistics for monitoring
   */
  async getTokenStats(sessionId?: string): Promise<{
    totalTokens: number;
    expiredTokens: number;
    validTokens: number;
    sessionTokens?: number;
  }> {
    try {
      const pattern = sessionId ? `csrf:${sessionId}:*` : 'csrf:*';
      const keys = await redisService.getKeysByPattern(pattern);
      
      let totalTokens = keys.length;
      let expiredTokens = 0;
      let validTokens = 0;

      const now = Date.now();
      
      for (const key of keys) {
        const tokenData = await redisService.get(key);
        if (tokenData) {
          const tokenInfo: CsrfTokenInfo = JSON.parse(tokenData);
          if (tokenInfo.expiresAt < now) {
            expiredTokens++;
          } else {
            validTokens++;
          }
        }
      }

      return {
        totalTokens,
        expiredTokens,
        validTokens,
        sessionTokens: sessionId ? totalTokens : undefined,
      };
    } catch (error) {
      console.error('Error getting CSRF token stats:', error);
      return {
        totalTokens: 0,
        expiredTokens: 0,
        validTokens: 0,
      };
    }
  }
}

/**
 * CSRF middleware function
 */
export function withCsrfProtection(
  handler: (request: NextRequest, csrfToken?: string) => Promise<NextResponse>,
  config?: Partial<CsrfConfig>
) {
  const csrf = new CsrfProtection(config);

  return async (request: NextRequest): Promise<NextResponse> => {
    const traceId = generateTraceId();

    try {
      // Extract session info
      const cookieName = process.env.SESSION_COOKIE_NAME || 'keyfront.sid';
      const sessionId = request.cookies.get(cookieName)?.value;

      // Always provide CSRF token for GET requests (token generation)
      if (!csrf.requiresProtection(request.method)) {
        // Generate new token for safe methods
        let csrfToken: string | undefined;
        
        if (sessionId) {
          const tokenInfo = await csrf.generateCsrfToken(sessionId, undefined, traceId);
          csrfToken = tokenInfo.token;
        }

        const response = await handler(request, csrfToken);
        
        // Add CSRF cookie to response
        if (csrfToken) {
          response.headers.set('Set-Cookie', csrf.createCsrfCookie(csrfToken));
        }
        
        return response;
      }

      // Validate CSRF token for state-changing methods
      if (!sessionId) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'CSRF_NO_SESSION',
              message: 'Session required for CSRF protection',
              traceId,
            },
          },
          { status: 401 }
        );
      }

      const token = csrf.extractToken(request);
      if (!token) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'CSRF_MISSING_TOKEN',
              message: 'CSRF token required',
              traceId,
            },
          },
          { status: 403 }
        );
      }

      const validation = await csrf.validateCsrfToken(token, sessionId, traceId);
      if (!validation.valid) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'CSRF_INVALID_TOKEN',
              message: `CSRF token validation failed: ${validation.reason}`,
              traceId,
            },
          },
          { status: 403 }
        );
      }

      // Call handler with validated token
      const response = await handler(request, token);
      
      // Generate new token for next request
      const newTokenInfo = await csrf.generateCsrfToken(sessionId, undefined, traceId);
      response.headers.set('Set-Cookie', csrf.createCsrfCookie(newTokenInfo.token));
      
      return response;
    } catch (error) {
      console.error('CSRF middleware error:', error);
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'CSRF_ERROR',
            message: 'CSRF protection error',
            traceId,
          },
        },
        { 
          status: 500,
          headers: {
            'x-keyfront-trace-id': traceId,
          }
        }
      );
    }
  };
}

// Global CSRF protection instance
export const globalCsrf = new CsrfProtection();

// Export for convenience
export { CsrfProtection as CSRF };