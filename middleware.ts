import { NextRequest, NextResponse } from 'next/server';
import { globalCors } from '@/lib/cors';
import { globalSecurityHeaders } from '@/lib/security-headers';
import { generateTraceId } from '@/lib/tracing';

export function middleware(request: NextRequest) {
  const traceId = generateTraceId();
  
  // Determine if connection is HTTPS
  const isHTTPS = request.url.startsWith('https') || 
                  request.headers.get('x-forwarded-proto') === 'https';
  
  // Apply CORS to all API routes
  if (request.nextUrl.pathname.startsWith('/api/')) {
    const corsResult = globalCors.handleRequest(request);

    // Block disallowed origins
    if (!corsResult.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'CORS_FORBIDDEN',
            message: 'CORS policy violation: Origin not allowed',
            traceId,
          },
        },
        { 
          status: 403,
          headers: {
            'x-keyfront-trace-id': traceId,
            ...corsResult.headers
          }
        }
      );
    }

    // Handle preflight requests
    if (request.method === 'OPTIONS' && !corsResult.shouldContinue) {
      const securityHeaders = globalSecurityHeaders.getSecurityHeaders(request, isHTTPS);
      return new NextResponse(null, {
        status: 204,
        headers: {
          'x-keyfront-trace-id': traceId,
          ...corsResult.headers,
          ...securityHeaders
        }
      });
    }

    // Add CORS and security headers to the response
    const response = NextResponse.next();
    
    // Apply CORS headers
    Object.entries(corsResult.headers).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    
    // Apply security headers
    const securityHeaders = globalSecurityHeaders.getSecurityHeaders(request, isHTTPS);
    Object.entries(securityHeaders).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    
    response.headers.set('x-keyfront-trace-id', traceId);
    
    return response;
  }

  // Apply security headers to all other routes (non-API)
  const response = NextResponse.next();
  const securityHeaders = globalSecurityHeaders.getSecurityHeaders(request, isHTTPS);
  Object.entries(securityHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  response.headers.set('x-keyfront-trace-id', traceId);
  
  return response;
}

export const config = {
  matcher: [
    '/api/:path*',
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};