import { NextRequest, NextResponse } from 'next/server';
import { generateTraceId } from './tracing';

export interface CorsOptions {
  origin?: string | string[] | boolean | ((origin: string, request: NextRequest) => boolean);
  methods?: string | string[];
  allowedHeaders?: string | string[];
  exposedHeaders?: string | string[];
  credentials?: boolean;
  maxAge?: number;
  preflightContinue?: boolean;
  optionsSuccessStatus?: number;
}

export interface CorsConfig extends CorsOptions {
  tenantOrigins?: Record<string, string[]>; // tenant-specific origins
  developmentMode?: boolean;
}

export class CorsManager {
  private config: Required<CorsConfig>;

  constructor(config: CorsConfig = {}) {
    this.config = {
      origin: this.parseOrigin(process.env.CORS_ORIGINS || '*'),
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Accept',
        'Accept-Language',
        'Content-Language',
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'X-Keyfront-Trace-ID',
        'X-Keyfront-Tenant-ID'
      ],
      exposedHeaders: [
        'X-RateLimit-Limit',
        'X-RateLimit-Remaining', 
        'X-RateLimit-Reset',
        'X-Keyfront-Trace-ID'
      ],
      credentials: true,
      maxAge: 86400, // 24 hours
      preflightContinue: false,
      optionsSuccessStatus: 204,
      tenantOrigins: {},
      developmentMode: process.env.NODE_ENV === 'development',
      ...config,
    };
  }

  private parseOrigin(origins: string): string[] | boolean {
    if (origins === '*') return true;
    if (origins === 'false') return false;
    return origins.split(',').map(o => o.trim());
  }

  private isOriginAllowed(origin: string | undefined, tenantId?: string): boolean {
    if (!origin) return false;

    // Development mode allows localhost
    if (this.config.developmentMode) {
      if (origin.match(/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/)) {
        return true;
      }
    }

    // Check tenant-specific origins first
    if (tenantId && this.config.tenantOrigins[tenantId]) {
      return this.config.tenantOrigins[tenantId].includes(origin);
    }

    // Check global origin configuration
    if (typeof this.config.origin === 'boolean') {
      return this.config.origin;
    }

    if (typeof this.config.origin === 'function') {
      // Note: We can't easily pass request here, so we'll use a simplified version
      return (this.config.origin as any)(origin, null);
    }

    if (Array.isArray(this.config.origin)) {
      return this.config.origin.includes(origin);
    }

    return this.config.origin === origin;
  }

  private buildCorsHeaders(
    origin: string | undefined, 
    method: string,
    requestHeaders: string | undefined,
    tenantId?: string
  ): Record<string, string> {
    const headers: Record<string, string> = {};

    // Handle origin
    if (this.isOriginAllowed(origin, tenantId)) {
      headers['Access-Control-Allow-Origin'] = origin || '*';
    }

    // Handle credentials
    if (this.config.credentials) {
      headers['Access-Control-Allow-Credentials'] = 'true';
    }

    // Handle methods
    if (method === 'OPTIONS') {
      const methods = Array.isArray(this.config.methods) 
        ? this.config.methods.join(', ')
        : this.config.methods;
      headers['Access-Control-Allow-Methods'] = methods;
    }

    // Handle headers
    if (method === 'OPTIONS' && requestHeaders) {
      // Validate requested headers against allowed headers
      const requestedHeaders = requestHeaders.split(',').map(h => h.trim());
      const allowedHeaders = Array.isArray(this.config.allowedHeaders)
        ? this.config.allowedHeaders
        : [this.config.allowedHeaders];
      
      const validHeaders = requestedHeaders.filter(header =>
        allowedHeaders.some(allowed => 
          allowed.toLowerCase() === header.toLowerCase()
        )
      );
      
      headers['Access-Control-Allow-Headers'] = validHeaders.join(', ');
    }

    // Expose headers
    if (this.config.exposedHeaders.length > 0) {
      const exposedHeaders = Array.isArray(this.config.exposedHeaders)
        ? this.config.exposedHeaders.join(', ')
        : this.config.exposedHeaders;
      headers['Access-Control-Expose-Headers'] = exposedHeaders;
    }

    // Max age for preflight
    if (method === 'OPTIONS') {
      headers['Access-Control-Max-Age'] = this.config.maxAge.toString();
    }

    return headers;
  }

  public handleRequest(request: NextRequest, tenantId?: string): {
    allowed: boolean;
    headers: Record<string, string>;
    shouldContinue: boolean;
  } {
    const origin = request.headers.get('origin');
    const method = request.method;
    const requestHeaders = request.headers.get('access-control-request-headers');

    const corsHeaders = this.buildCorsHeaders(origin, method, requestHeaders, tenantId);
    const isAllowed = this.isOriginAllowed(origin, tenantId);

    // Handle preflight requests
    if (method === 'OPTIONS') {
      return {
        allowed: isAllowed,
        headers: corsHeaders,
        shouldContinue: this.config.preflightContinue
      };
    }

    return {
      allowed: isAllowed,
      headers: corsHeaders,
      shouldContinue: true
    };
  }

  public addTenantOrigins(tenantId: string, origins: string[]): void {
    this.config.tenantOrigins[tenantId] = origins;
  }

  public removeTenantOrigins(tenantId: string): void {
    delete this.config.tenantOrigins[tenantId];
  }
}

// CORS middleware function
export function withCors(
  handler: (request: NextRequest) => Promise<NextResponse>,
  options?: CorsConfig
) {
  const corsManager = new CorsManager(options);

  return async (request: NextRequest): Promise<NextResponse> => {
    const traceId = generateTraceId();
    
    try {
      // Extract tenant ID from request (could be from header, JWT, or session)
      const tenantId = request.headers.get('x-keyfront-tenant-id') || undefined;

      const corsResult = corsManager.handleRequest(request, tenantId);

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
            }
          }
        );
      }

      // Handle preflight requests
      if (request.method === 'OPTIONS' && !corsResult.shouldContinue) {
        return new NextResponse(null, {
          status: corsManager['config'].optionsSuccessStatus,
          headers: corsResult.headers
        });
      }

      // Call the handler
      const response = await handler(request);

      // Add CORS headers to response
      Object.entries(corsResult.headers).forEach(([key, value]) => {
        response.headers.set(key, value);
      });

      return response;
    } catch (error) {
      console.error('CORS middleware error:', error);
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'CORS_ERROR',
            message: 'CORS processing error',
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

// Global CORS manager instance
export const globalCors = new CorsManager();