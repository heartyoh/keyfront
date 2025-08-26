import { NextRequest, NextResponse } from 'next/server';
import { redisService } from '@/services/redis';
import { RateLimitError, buildErrorResponse } from '@/lib/errors';
import { generateTraceId } from '@/lib/tracing';
import { auditEvents } from '@/lib/audit';
import { UserSession } from '@/types/auth';

export interface RateLimitConfig {
  windowMs: number;      // Time window in milliseconds
  maxRequests: number;   // Maximum requests per window
  message?: string;      // Custom error message
  skipSuccessfulRequests?: boolean;  // Don't count successful requests
  skipFailedRequests?: boolean;      // Don't count failed requests
  keyGenerator?: (req: NextRequest, user?: UserSession) => string;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  current: number;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
}

export class RateLimiter {
  private config: RateLimitConfig;
  private keyPrefix: string;

  constructor(config: RateLimitConfig, keyPrefix: string = 'ratelimit') {
    this.config = {
      message: 'Too many requests, please try again later',
      skipSuccessfulRequests: false,
      skipFailedRequests: false,
      keyGenerator: this.defaultKeyGenerator,
      ...config,
    };
    this.keyPrefix = keyPrefix;
  }

  get windowMs(): number {
    return this.config.windowMs;
  }

  get message(): string {
    return this.config.message || 'Too many requests, please try again later';
  }

  async check(
    request: NextRequest, 
    user?: UserSession,
    traceId?: string
  ): Promise<RateLimitResult> {
    const key = this.config.keyGenerator!(request, user);
    const windowKey = this.getWindowKey(key);
    
    try {
      // Use Redis pipeline for atomic operations
      const pipeline = redisService.pipeline();
      
      // Get current count
      pipeline.get(windowKey);
      // Increment counter
      pipeline.incr(windowKey);
      // Set expiration if key is new
      pipeline.expire(windowKey, Math.ceil(this.config.windowMs / 1000));
      
      const results = await pipeline.exec();
      
      if (!results) {
        throw new Error('Redis pipeline failed');
      }

      const currentCount = parseInt(results[1][1] as string);
      const resetTime = Date.now() + this.config.windowMs;
      
      const result: RateLimitResult = {
        allowed: currentCount <= this.config.maxRequests,
        limit: this.config.maxRequests,
        current: currentCount,
        remaining: Math.max(0, this.config.maxRequests - currentCount),
        resetTime,
        retryAfter: currentCount > this.config.maxRequests 
          ? Math.ceil(this.config.windowMs / 1000) 
          : undefined,
      };

      // Log rate limit hit
      if (!result.allowed && user) {
        await auditEvents.rateLimitHit(
          traceId || generateTraceId(),
          user.tenantId,
          user.sub,
          key,
          {
            limit: this.config.maxRequests,
            current: currentCount,
            windowMs: this.config.windowMs,
            key,
          }
        );
      }

      return result;
    } catch (error) {
      console.error('Rate limit check failed:', error);
      // In case of Redis failure, allow the request (fail open)
      return {
        allowed: true,
        limit: this.config.maxRequests,
        current: 0,
        remaining: this.config.maxRequests,
        resetTime: Date.now() + this.config.windowMs,
      };
    }
  }

  private defaultKeyGenerator(req: NextRequest, user?: UserSession): string {
    // Use user ID if authenticated, otherwise fall back to IP
    if (user) {
      return `user:${user.tenantId}:${user.sub}`;
    }
    
    // Try to get real IP from various headers
    const forwardedFor = req.headers.get('x-forwarded-for');
    const realIp = req.headers.get('x-real-ip');
    const ip = forwardedFor?.split(',')[0] || realIp || req.ip || 'unknown';
    
    return `ip:${ip}`;
  }

  private getWindowKey(key: string): string {
    const window = Math.floor(Date.now() / this.config.windowMs);
    return `${this.keyPrefix}:${key}:${window}`;
  }
}

// Predefined rate limiters
export const rateLimiters = {
  // Global IP-based rate limiting
  global: new RateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 1000,
    message: 'Too many requests from this IP',
  }, 'global'),

  // Per-user rate limiting
  user: new RateLimiter({
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 100,
    message: 'Too many requests from this user',
    keyGenerator: (req, user) => user ? `user:${user.tenantId}:${user.sub}` : `ip:${req.ip}`,
  }, 'user'),

  // Tenant-based rate limiting
  tenant: new RateLimiter({
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 500,
    message: 'Tenant rate limit exceeded',
    keyGenerator: (req, user) => user ? `tenant:${user.tenantId}` : `ip:${req.ip}`,
  }, 'tenant'),

  // Login attempt rate limiting
  login: new RateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 5,
    message: 'Too many login attempts, please try again later',
    keyGenerator: (req) => {
      const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || req.ip || 'unknown';
      return `login:${ip}`;
    },
  }, 'login'),

  // API endpoint specific
  api: new RateLimiter({
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 200,
    message: 'API rate limit exceeded',
    keyGenerator: (req, user) => {
      const endpoint = req.nextUrl.pathname;
      const key = user ? `user:${user.tenantId}:${user.sub}` : `ip:${req.ip}`;
      return `api:${endpoint}:${key}`;
    },
  }, 'api'),
};

// Middleware factory
export function createRateLimitMiddleware(
  limiter: RateLimiter,
  options?: {
    skip?: (req: NextRequest, user?: UserSession) => boolean;
    onLimitReached?: (req: NextRequest, result: RateLimitResult) => void;
  }
) {
  return async function rateLimitMiddleware(
    request: NextRequest,
    user?: UserSession,
    traceId?: string
  ): Promise<NextResponse | null> {
    // Skip if condition is met
    if (options?.skip && options.skip(request, user)) {
      return null;
    }

    const result = await limiter.check(request, user, traceId);

    // Set rate limit headers
    const headers: Record<string, string> = {
      'X-RateLimit-Limit': result.limit.toString(),
      'X-RateLimit-Remaining': result.remaining.toString(),
      'X-RateLimit-Reset': result.resetTime.toString(),
      'X-RateLimit-Window': limiter.windowMs.toString(),
    };

    if (!result.allowed) {
      // Call custom handler if provided
      if (options?.onLimitReached) {
        options.onLimitReached(request, result);
      }

      headers['Retry-After'] = result.retryAfter?.toString() || '60';

      const error = new RateLimitError(
        limiter.message,
        traceId,
        {
          limit: result.limit,
          current: result.current,
          resetTime: result.resetTime,
          retryAfter: result.retryAfter,
        }
      );

      const { response, status } = buildErrorResponse(error, traceId);
      
      return NextResponse.json(response, {
        status,
        headers,
      });
    }

    // Store rate limit info for use in response headers
    (request as any).rateLimitResult = result;

    return null; // Allow request to proceed
  };
}

// Helper to add rate limit headers to successful responses
export function addRateLimitHeaders(
  response: NextResponse,
  result: RateLimitResult
): NextResponse {
  response.headers.set('X-RateLimit-Limit', result.limit.toString());
  response.headers.set('X-RateLimit-Remaining', result.remaining.toString());
  response.headers.set('X-RateLimit-Reset', result.resetTime.toString());
  
  return response;
}

// Composite rate limiter that applies multiple limits
export class CompositeRateLimiter {
  private limiters: Array<{ limiter: RateLimiter; name: string }>;

  constructor(limiters: Array<{ limiter: RateLimiter; name: string }>) {
    this.limiters = limiters;
  }

  async checkAll(
    request: NextRequest,
    user?: UserSession,
    traceId?: string
  ): Promise<RateLimitResult> {
    let mostRestrictive: RateLimitResult | null = null;

    for (const { limiter, name } of this.limiters) {
      const result = await limiter.check(request, user, traceId);
      
      if (!result.allowed) {
        return result; // Return first failing limit
      }

      // Track most restrictive limit
      if (!mostRestrictive || result.remaining < mostRestrictive.remaining) {
        mostRestrictive = result;
      }
    }

    return mostRestrictive || {
      allowed: true,
      limit: 0,
      current: 0,
      remaining: 0,
      resetTime: Date.now(),
    };
  }
}

// Global composite limiter
export const globalRateLimiter = new CompositeRateLimiter([
  { limiter: rateLimiters.global, name: 'global' },
  { limiter: rateLimiters.user, name: 'user' },
  { limiter: rateLimiters.tenant, name: 'tenant' },
]);