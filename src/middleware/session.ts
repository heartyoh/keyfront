import { NextRequest, NextResponse } from 'next/server';
import { redisService } from '@/services/redis';
import { UserSession } from '@/types/auth';
import { globalRateLimiter, addRateLimitHeaders } from '@/lib/rate-limit';
import { generateTraceId } from '@/lib/tracing';
import { metricsCollector } from '@/lib/metrics';
import { errorTracker } from '@/services/error-tracking';

export interface AuthenticatedRequest extends NextRequest {
  user?: UserSession;
  sessionId?: string;
}

export async function withSession(
  request: NextRequest,
  handler: (req: AuthenticatedRequest) => Promise<NextResponse>
): Promise<NextResponse> {
  const traceId = generateTraceId();
  const startTime = Date.now();
  
  try {
    const cookieName = process.env.SESSION_COOKIE_NAME || 'keyfront.sid';
    const sessionId = request.cookies.get(cookieName)?.value;

    // Apply rate limiting first (before authentication)
    const rateLimitResult = await globalRateLimiter.checkAll(request, undefined, traceId);
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests, please try again later',
            traceId,
          },
        },
        { 
          status: 429,
          headers: {
            'X-RateLimit-Limit': rateLimitResult.limit.toString(),
            'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
            'X-RateLimit-Reset': rateLimitResult.resetTime.toString(),
            'Retry-After': rateLimitResult.retryAfter?.toString() || '60',
            'x-keyfront-trace-id': traceId,
          }
        }
      );
    }

    if (!sessionId) {
      const duration = Date.now() - startTime;
      
      // Record metrics for unauthorized request
      await metricsCollector.recordRequestDuration(
        request.method,
        request.nextUrl.pathname,
        401,
        duration,
        { 
          authenticated: 'false',
          reason: 'no_session_cookie',
          trace_id: traceId
        }
      );
      
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'No session found',
            traceId,
          },
        },
        { 
          status: 401,
          headers: {
            'x-keyfront-trace-id': traceId,
          }
        }
      );
    }

    // Get session from Redis
    const session = await redisService.getSession(sessionId);
    if (!session) {
      const duration = Date.now() - startTime;
      
      // Record metrics for unauthorized request
      await metricsCollector.recordRequestDuration(
        request.method,
        request.nextUrl.pathname,
        401,
        duration,
        { 
          authenticated: 'false',
          reason: 'invalid_session',
          trace_id: traceId
        }
      );
      
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid or expired session',
            traceId,
          },
        },
        { 
          status: 401,
          headers: {
            'x-keyfront-trace-id': traceId,
          }
        }
      );
    }

    // Check if session is expired
    if (session.expiresAt < Date.now()) {
      await redisService.deleteSession(sessionId);
      const duration = Date.now() - startTime;
      
      // Record metrics for expired session
      await metricsCollector.recordRequestDuration(
        request.method,
        request.nextUrl.pathname,
        401,
        duration,
        { 
          authenticated: 'false',
          reason: 'session_expired',
          trace_id: traceId
        }
      );
      
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'SESSION_EXPIRED',
            message: 'Session has expired',
            traceId,
          },
        },
        { 
          status: 401,
          headers: {
            'x-keyfront-trace-id': traceId,
          }
        }
      );
    }

    // Apply user-specific rate limiting
    const userRateLimitResult = await globalRateLimiter.checkAll(request, session, traceId);
    if (!userRateLimitResult.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'User rate limit exceeded',
            traceId,
          },
        },
        { 
          status: 429,
          headers: {
            'X-RateLimit-Limit': userRateLimitResult.limit.toString(),
            'X-RateLimit-Remaining': userRateLimitResult.remaining.toString(),
            'X-RateLimit-Reset': userRateLimitResult.resetTime.toString(),
            'Retry-After': userRateLimitResult.retryAfter?.toString() || '60',
            'x-keyfront-trace-id': traceId,
          }
        }
      );
    }

    // Update last activity
    await redisService.updateSessionActivity(sessionId);

    // Create authenticated request
    const authenticatedRequest = request as AuthenticatedRequest;
    authenticatedRequest.user = session;
    authenticatedRequest.sessionId = sessionId;

    // Call the handler
    const response = await handler(authenticatedRequest);
    const duration = Date.now() - startTime;
    
    // Record metrics
    await metricsCollector.recordRequestDuration(
      request.method,
      request.nextUrl.pathname,
      response.status,
      duration,
      { 
        authenticated: 'true',
        tenant_id: session.tenantId,
        trace_id: traceId
      }
    );
    
    // Add rate limit headers to successful responses
    return addRateLimitHeaders(response, userRateLimitResult);
  } catch (error) {
    console.error('Session middleware error:', error);
    const duration = Date.now() - startTime;
    
    // Record error for tracking
    try {
      await errorTracker.recordError({
        message: error instanceof Error ? error.message : 'Unknown session middleware error',
        stack: error instanceof Error ? error.stack : undefined,
        type: error instanceof Error ? error.constructor.name : 'UnknownError',
        severity: 'high',
        traceId,
        tenantId: 'system', // System-level error
        context: {
          method: request.method,
          url: request.url,
          route: request.nextUrl.pathname,
          userAgent: request.headers.get('user-agent') || undefined,
          ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined,
          statusCode: 500,
        },
        tags: ['middleware', 'session', 'authentication'],
      });
    } catch (trackingError) {
      console.error('Failed to track error:', trackingError);
    }
    
    // Record error metrics
    await metricsCollector.recordRequestDuration(
      request.method,
      request.nextUrl.pathname,
      500,
      duration,
      { 
        authenticated: 'error',
        error_type: error instanceof Error ? error.constructor.name : 'unknown',
        trace_id: traceId
      }
    );
    
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
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
}

export function requireRole(roles: string[]) {
  return async (
    request: AuthenticatedRequest,
    handler: (req: AuthenticatedRequest) => Promise<NextResponse>
  ): Promise<NextResponse> => {
    if (!request.user) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'User not authenticated',
          },
        },
        { status: 401 }
      );
    }

    const hasRole = request.user.roles.some(role => roles.includes(role));
    if (!hasRole) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Insufficient permissions',
          },
        },
        { status: 403 }
      );
    }

    return await handler(request);
  };
}

export function requireTenant(tenantId?: string) {
  return async (
    request: AuthenticatedRequest,
    handler: (req: AuthenticatedRequest) => Promise<NextResponse>
  ): Promise<NextResponse> => {
    if (!request.user) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'User not authenticated',
          },
        },
        { status: 401 }
      );
    }

    // If tenantId is provided, check if user belongs to that tenant
    if (tenantId && request.user.tenantId !== tenantId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Access denied to this tenant',
          },
        },
        { status: 403 }
      );
    }

    return await handler(request);
  };
}
