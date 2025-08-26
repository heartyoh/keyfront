import { NextRequest, NextResponse } from 'next/server';
import { generateTraceId } from './tracing';

export interface SecurityHeadersConfig {
  contentSecurityPolicy?: {
    directives: Record<string, string | string[]>;
    reportOnly?: boolean;
    reportUri?: string;
  };
  strictTransportSecurity?: {
    maxAge: number;
    includeSubDomains?: boolean;
    preload?: boolean;
  };
  frameOptions?: 'DENY' | 'SAMEORIGIN' | string; // string for ALLOW-FROM
  contentTypeOptions?: boolean;
  referrerPolicy?: 'no-referrer' | 'no-referrer-when-downgrade' | 'origin' | 'origin-when-cross-origin' | 'same-origin' | 'strict-origin' | 'strict-origin-when-cross-origin' | 'unsafe-url';
  permissionsPolicy?: Record<string, string[]>;
  crossOriginEmbedderPolicy?: 'require-corp' | 'unsafe-none';
  crossOriginOpenerPolicy?: 'same-origin' | 'same-origin-allow-popups' | 'unsafe-none';
  crossOriginResourcePolicy?: 'same-site' | 'same-origin' | 'cross-origin';
  dnsPrefetchControl?: boolean;
  expectCt?: {
    maxAge: number;
    enforce?: boolean;
    reportUri?: string;
  };
  featurePolicy?: Record<string, string[]>; // Legacy, use permissionsPolicy instead
  hpkp?: {
    pins: string[];
    maxAge: number;
    includeSubDomains?: boolean;
    reportUri?: string;
  };
  ieNoOpen?: boolean;
  noSniff?: boolean;
  originAgentCluster?: boolean;
  xssFilter?: boolean;
}

export class SecurityHeadersManager {
  private config: SecurityHeadersConfig;

  constructor(config: SecurityHeadersConfig = {}) {
    this.config = {
      contentSecurityPolicy: {
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:', 'https:'],
          'font-src': ["'self'", 'https:', 'data:'],
          'connect-src': ["'self'", 'ws:', 'wss:'],
          'media-src': ["'self'"],
          'object-src': ["'none'"],
          'child-src': ["'self'"],
          'worker-src': ["'self'"],
          'frame-ancestors': ["'none'"],
          'form-action': ["'self'"],
          'base-uri': ["'self'"],
          'upgrade-insecure-requests': []
        },
        reportOnly: false,
      },
      strictTransportSecurity: {
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: true,
      },
      frameOptions: 'DENY',
      contentTypeOptions: true,
      referrerPolicy: 'strict-origin-when-cross-origin',
      permissionsPolicy: {
        'accelerometer': [],
        'camera': [],
        'geolocation': [],
        'gyroscope': [],
        'magnetometer': [],
        'microphone': [],
        'payment': [],
        'usb': [],
      },
      crossOriginEmbedderPolicy: 'unsafe-none',
      crossOriginOpenerPolicy: 'same-origin',
      crossOriginResourcePolicy: 'cross-origin',
      dnsPrefetchControl: false,
      expectCt: {
        maxAge: 86400,
        enforce: false,
      },
      ieNoOpen: true,
      noSniff: true,
      originAgentCluster: true,
      xssFilter: true,
      ...config,
    };
  }

  private buildCSPString(): string {
    const { directives } = this.config.contentSecurityPolicy!;
    return Object.entries(directives)
      .map(([key, value]) => {
        if (Array.isArray(value)) {
          return value.length > 0 ? `${key} ${value.join(' ')}` : key;
        }
        return `${key} ${value}`;
      })
      .join('; ');
  }

  private buildHSTSString(): string {
    const { maxAge, includeSubDomains, preload } = this.config.strictTransportSecurity!;
    let hsts = `max-age=${maxAge}`;
    if (includeSubDomains) hsts += '; includeSubDomains';
    if (preload) hsts += '; preload';
    return hsts;
  }

  private buildPermissionsPolicyString(): string {
    const policies = this.config.permissionsPolicy!;
    return Object.entries(policies)
      .map(([key, value]) => {
        if (value.length === 0) {
          return `${key}=()`;
        }
        return `${key}=(${value.join(' ')})`;
      })
      .join(', ');
  }

  private buildExpectCtString(): string {
    const { maxAge, enforce, reportUri } = this.config.expectCt!;
    let expectCt = `max-age=${maxAge}`;
    if (enforce) expectCt += ', enforce';
    if (reportUri) expectCt += `, report-uri="${reportUri}"`;
    return expectCt;
  }

  private buildHPKPString(): string {
    const { pins, maxAge, includeSubDomains, reportUri } = this.config.hpkp!;
    let hpkp = pins.map(pin => `pin-sha256="${pin}"`).join('; ');
    hpkp += `; max-age=${maxAge}`;
    if (includeSubDomains) hpkp += '; includeSubDomains';
    if (reportUri) hpkp += `; report-uri="${reportUri}"`;
    return hpkp;
  }

  public getSecurityHeaders(request: NextRequest, isHTTPS: boolean = false): Record<string, string> {
    const headers: Record<string, string> = {};

    // Content Security Policy
    if (this.config.contentSecurityPolicy) {
      const csp = this.buildCSPString();
      const headerName = this.config.contentSecurityPolicy.reportOnly 
        ? 'Content-Security-Policy-Report-Only' 
        : 'Content-Security-Policy';
      headers[headerName] = csp;
    }

    // Strict Transport Security (HTTPS only)
    if (this.config.strictTransportSecurity && isHTTPS) {
      headers['Strict-Transport-Security'] = this.buildHSTSString();
    }

    // X-Frame-Options
    if (this.config.frameOptions) {
      headers['X-Frame-Options'] = this.config.frameOptions;
    }

    // X-Content-Type-Options
    if (this.config.contentTypeOptions) {
      headers['X-Content-Type-Options'] = 'nosniff';
    }

    // Referrer-Policy
    if (this.config.referrerPolicy) {
      headers['Referrer-Policy'] = this.config.referrerPolicy;
    }

    // Permissions-Policy
    if (this.config.permissionsPolicy) {
      headers['Permissions-Policy'] = this.buildPermissionsPolicyString();
    }

    // Cross-Origin-Embedder-Policy
    if (this.config.crossOriginEmbedderPolicy) {
      headers['Cross-Origin-Embedder-Policy'] = this.config.crossOriginEmbedderPolicy;
    }

    // Cross-Origin-Opener-Policy
    if (this.config.crossOriginOpenerPolicy) {
      headers['Cross-Origin-Opener-Policy'] = this.config.crossOriginOpenerPolicy;
    }

    // Cross-Origin-Resource-Policy
    if (this.config.crossOriginResourcePolicy) {
      headers['Cross-Origin-Resource-Policy'] = this.config.crossOriginResourcePolicy;
    }

    // X-DNS-Prefetch-Control
    if (this.config.dnsPrefetchControl !== undefined) {
      headers['X-DNS-Prefetch-Control'] = this.config.dnsPrefetchControl ? 'on' : 'off';
    }

    // Expect-CT
    if (this.config.expectCt && isHTTPS) {
      headers['Expect-CT'] = this.buildExpectCtString();
    }

    // Public-Key-Pins (deprecated but still useful)
    if (this.config.hpkp && isHTTPS) {
      headers['Public-Key-Pins'] = this.buildHPKPString();
    }

    // X-Download-Options (IE)
    if (this.config.ieNoOpen) {
      headers['X-Download-Options'] = 'noopen';
    }

    // X-Content-Type-Options (legacy support)
    if (this.config.noSniff) {
      headers['X-Content-Type-Options'] = 'nosniff';
    }

    // Origin-Agent-Cluster
    if (this.config.originAgentCluster) {
      headers['Origin-Agent-Cluster'] = '?1';
    }

    // X-XSS-Protection (legacy but still useful)
    if (this.config.xssFilter) {
      headers['X-XSS-Protection'] = '1; mode=block';
    }

    return headers;
  }

  // Environment-specific configurations
  public static development(): SecurityHeadersManager {
    return new SecurityHeadersManager({
      contentSecurityPolicy: {
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'localhost:*'],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:', 'https:', 'http://localhost:*'],
          'connect-src': ["'self'", 'ws://localhost:*', 'wss://localhost:*', 'http://localhost:*', 'https://localhost:*'],
          'font-src': ["'self'", 'data:'],
          'object-src': ["'none'"],
          'media-src': ["'self'"],
          'frame-ancestors': ["'self'"],
          'form-action': ["'self'"],
          'base-uri': ["'self'"]
        },
        reportOnly: true, // Less strict in development
      },
      strictTransportSecurity: undefined, // Disable HSTS in development
      frameOptions: 'SAMEORIGIN',
      crossOriginResourcePolicy: 'cross-origin',
    });
  }

  public static production(): SecurityHeadersManager {
    return new SecurityHeadersManager({
      contentSecurityPolicy: {
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"], // Required for some CSS frameworks
          'img-src': ["'self'", 'data:', 'https:'],
          'connect-src': ["'self'", 'wss:'],
          'font-src': ["'self'"],
          'object-src': ["'none'"],
          'media-src': ["'self'"],
          'frame-ancestors': ["'none'"],
          'form-action': ["'self'"],
          'base-uri': ["'self'"],
          'upgrade-insecure-requests': []
        },
        reportOnly: false,
      },
      strictTransportSecurity: {
        maxAge: 63072000, // 2 years
        includeSubDomains: true,
        preload: true,
      },
      frameOptions: 'DENY',
      crossOriginResourcePolicy: 'same-origin',
    });
  }
}

// Middleware function to apply security headers
export function withSecurityHeaders(
  handler: (request: NextRequest) => Promise<NextResponse>,
  config?: SecurityHeadersConfig
) {
  const manager = config 
    ? new SecurityHeadersManager(config)
    : process.env.NODE_ENV === 'production' 
      ? SecurityHeadersManager.production()
      : SecurityHeadersManager.development();

  return async (request: NextRequest): Promise<NextResponse> => {
    const traceId = generateTraceId();
    
    try {
      // Call the handler first
      const response = await handler(request);

      // Determine if connection is HTTPS
      const isHTTPS = request.url.startsWith('https') || 
                     request.headers.get('x-forwarded-proto') === 'https';

      // Get security headers
      const securityHeaders = manager.getSecurityHeaders(request, isHTTPS);

      // Apply security headers to response
      Object.entries(securityHeaders).forEach(([key, value]) => {
        response.headers.set(key, value);
      });

      // Add trace ID
      response.headers.set('x-keyfront-trace-id', traceId);

      return response;
    } catch (error) {
      console.error('Security headers middleware error:', error);
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'SECURITY_HEADERS_ERROR',
            message: 'Security headers processing error',
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

// Global security headers manager
export const globalSecurityHeaders = process.env.NODE_ENV === 'production'
  ? SecurityHeadersManager.production()
  : SecurityHeadersManager.development();