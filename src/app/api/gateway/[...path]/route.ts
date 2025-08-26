import { NextRequest, NextResponse } from 'next/server';
import { withSession, AuthenticatedRequest } from '@/middleware/session';
import { proxyService } from '@/services/proxy';
import { auditLogger } from '@/lib/audit';
import { generateTraceId } from '@/lib/tracing';

async function handler(request: AuthenticatedRequest): Promise<NextResponse> {
  const traceId = generateTraceId();
  const startTime = Date.now();

  try {
    if (!request.user) {
      await auditLogger.log({
        traceId,
        tenantId: 'unknown',
        userId: 'anonymous',
        action: 'gateway_access',
        resourceType: 'api',
        resourceId: request.nextUrl.pathname,
        result: 'deny',
        reason: 'unauthenticated',
        metadata: {
          method: request.method,
          path: request.nextUrl.pathname,
          ipAddress: request.ip,
          userAgent: request.headers.get('user-agent'),
        },
      });

      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
            traceId,
          },
        },
        { status: 401 }
      );
    }

    // Extract downstream path
    const url = new URL(request.nextUrl);
    const pathSegments = url.pathname.split('/');
    // Remove /api/gateway from path
    const downstreamPath = pathSegments.slice(3).join('/');
    
    if (!downstreamPath) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVALID_PATH',
            message: 'Gateway path is required',
            traceId,
          },
        },
        { status: 400 }
      );
    }

    // Proxy request to downstream service
    const response = await proxyService.forward({
      method: request.method as any,
      path: downstreamPath,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: Object.fromEntries(request.headers.entries()),
      body: request.method !== 'GET' && request.method !== 'HEAD' 
        ? await request.text() 
        : undefined,
      user: request.user,
      traceId,
    });

    const duration = Date.now() - startTime;

    // Log successful request
    await auditLogger.log({
      traceId,
      tenantId: request.user.tenantId,
      userId: request.user.sub,
      action: 'gateway_proxy',
      resourceType: 'api',
      resourceId: downstreamPath,
      result: response.status < 400 ? 'allow' : 'error',
      reason: response.status >= 400 ? `HTTP ${response.status}` : undefined,
      metadata: {
        method: request.method,
        path: downstreamPath,
        statusCode: response.status,
        duration,
        ipAddress: request.ip,
        userAgent: request.headers.get('user-agent'),
      },
    });

    // Return proxied response
    return new NextResponse(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        ...Object.fromEntries(response.headers.entries()),
        'x-keyfront-trace-id': traceId,
        'x-keyfront-duration': duration.toString(),
      },
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    
    console.error('Gateway proxy error:', error);

    // Log error
    await auditLogger.log({
      traceId,
      tenantId: request.user?.tenantId || 'unknown',
      userId: request.user?.sub || 'unknown',
      action: 'gateway_proxy',
      resourceType: 'api',
      resourceId: request.nextUrl.pathname,
      result: 'error',
      reason: error instanceof Error ? error.message : 'Unknown error',
      metadata: {
        method: request.method,
        path: request.nextUrl.pathname,
        duration,
        error: error instanceof Error ? error.stack : String(error),
        ipAddress: request.ip,
        userAgent: request.headers.get('user-agent'),
      },
    });

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'PROXY_ERROR',
          message: 'Gateway proxy failed',
          traceId,
        },
      },
      { 
        status: 502,
        headers: {
          'x-keyfront-trace-id': traceId,
          'x-keyfront-duration': duration.toString(),
        },
      }
    );
  }
}

// Export HTTP methods
export const GET = (request: NextRequest) => withSession(request, handler);
export const POST = (request: NextRequest) => withSession(request, handler);
export const PUT = (request: NextRequest) => withSession(request, handler);
export const DELETE = (request: NextRequest) => withSession(request, handler);
export const PATCH = (request: NextRequest) => withSession(request, handler);
export const HEAD = (request: NextRequest) => withSession(request, handler);
export const OPTIONS = (request: NextRequest) => withSession(request, handler);