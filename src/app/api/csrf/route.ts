import { NextRequest, NextResponse } from 'next/server';
import { globalCsrf } from '@/lib/csrf';
import { withSession, AuthenticatedRequest } from '@/middleware/session';
import { generateTraceId } from '@/lib/tracing';

async function handler(request: AuthenticatedRequest): Promise<NextResponse> {
  const traceId = generateTraceId();

  try {
    const sessionId = request.sessionId;
    const user = request.user;

    if (request.method === 'GET') {
      // Generate new CSRF token
      const tokenInfo = await globalCsrf.generateCsrfToken(sessionId!, user, traceId);
      
      const response = NextResponse.json({
        success: true,
        data: {
          token: tokenInfo.token,
          expiresAt: tokenInfo.expiresAt,
        },
        traceId,
      });

      // Set CSRF cookie
      response.headers.set('Set-Cookie', globalCsrf.createCsrfCookie(tokenInfo.token));
      
      return response;
    }

    if (request.method === 'DELETE') {
      // Invalidate all CSRF tokens for session
      const invalidatedCount = await globalCsrf.invalidateSessionTokens(sessionId!);
      
      return NextResponse.json({
        success: true,
        data: {
          invalidatedTokens: invalidatedCount,
        },
        message: 'All CSRF tokens invalidated',
        traceId,
      });
    }

    if (request.method === 'POST') {
      // Validate existing token
      const body = await request.json();
      const token = body.token || globalCsrf.extractToken(request);

      if (!token) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'CSRF_TOKEN_REQUIRED',
              message: 'CSRF token is required',
              traceId,
            },
          },
          { status: 400 }
        );
      }

      const validation = await globalCsrf.validateCsrfToken(token, sessionId!, traceId);
      
      if (!validation.valid) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'CSRF_TOKEN_INVALID',
              message: `Token validation failed: ${validation.reason}`,
              traceId,
            },
          },
          { status: 403 }
        );
      }

      return NextResponse.json({
        success: true,
        data: {
          valid: true,
          tokenInfo: validation.tokenInfo,
        },
        message: 'CSRF token is valid',
        traceId,
      });
    }

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'METHOD_NOT_ALLOWED',
          message: 'Method not allowed',
          traceId,
        },
      },
      { status: 405 }
    );
  } catch (error) {
    console.error('CSRF API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'CSRF_API_ERROR',
          message: 'CSRF API processing error',
          traceId,
        },
      },
      { status: 500 }
    );
  }
}

export const GET = withSession(handler);
export const POST = withSession(handler);
export const DELETE = withSession(handler);