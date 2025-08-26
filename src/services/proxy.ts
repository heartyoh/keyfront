import { UserSession } from '@/types/auth';
import { KeyfrontError } from '@/lib/errors';

export interface ProxyRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';
  path: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: string;
  user: UserSession;
  traceId: string;
}

export interface ProxyResponse {
  status: number;
  statusText: string;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
}

export class ProxyService {
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly retryAttempts: number;
  private readonly retryDelay: number;

  constructor() {
    this.baseUrl = process.env.DOWNSTREAM_API_BASE || 'http://localhost:4000';
    this.timeout = parseInt(process.env.DOWNSTREAM_API_TIMEOUT || '30000');
    this.retryAttempts = parseInt(process.env.PROXY_RETRY_ATTEMPTS || '3');
    this.retryDelay = parseInt(process.env.PROXY_RETRY_DELAY || '1000');
  }

  async forward(request: ProxyRequest): Promise<ProxyResponse> {
    const { method, path, query, headers, body, user, traceId } = request;

    // Build target URL
    const url = new URL(`/api/v1/${path}`, this.baseUrl);
    if (query) {
      Object.entries(query).forEach(([key, value]) => {
        url.searchParams.append(key, value);
      });
    }

    // Prepare headers for downstream
    const downstreamHeaders = this.prepareHeaders(headers || {}, user, traceId);

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      let lastError: Error | null = null;

      // Retry logic
      for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
        try {
          console.log(`Proxying request: ${method} ${url.toString()} (attempt ${attempt})`);

          const response = await fetch(url.toString(), {
            method,
            headers: downstreamHeaders,
            body: method !== 'GET' && method !== 'HEAD' ? body : undefined,
            signal: controller.signal,
          });

          console.log(`Proxy response: ${response.status} ${response.statusText}`);

          // Clear timeout
          clearTimeout(timeoutId);

          // Filter response headers (remove sensitive headers)
          const filteredHeaders = this.filterResponseHeaders(response.headers);

          return {
            status: response.status,
            statusText: response.statusText,
            headers: filteredHeaders,
            body: response.body,
          };

        } catch (error) {
          lastError = error as Error;
          console.error(`Proxy attempt ${attempt} failed:`, error);

          // Don't retry on abort (timeout) or certain errors
          if (error instanceof Error) {
            if (error.name === 'AbortError') {
              throw new KeyfrontError(
                'PROXY_TIMEOUT',
                `Downstream service timeout after ${this.timeout}ms`,
                traceId
              );
            }
          }

          // Wait before retry (except on last attempt)
          if (attempt < this.retryAttempts) {
            await this.delay(this.retryDelay * attempt);
          }
        }
      }

      // All retries failed
      throw new KeyfrontError(
        'PROXY_FAILED',
        `Downstream service unavailable after ${this.retryAttempts} attempts: ${lastError?.message}`,
        traceId
      );

    } finally {
      clearTimeout(timeoutId);
    }
  }

  private prepareHeaders(
    originalHeaders: Record<string, string>,
    user: UserSession,
    traceId: string
  ): Record<string, string> {
    // Filter out problematic headers
    const headersToRemove = [
      'host',
      'connection',
      'upgrade',
      'cookie',
      'authorization',
      'x-forwarded-for',
      'x-forwarded-host',
      'x-forwarded-proto',
    ];

    const filteredHeaders = Object.entries(originalHeaders)
      .filter(([key]) => !headersToRemove.includes(key.toLowerCase()))
      .reduce((acc, [key, value]) => {
        acc[key] = value;
        return acc;
      }, {} as Record<string, string>);

    // Add authentication and context headers
    return {
      ...filteredHeaders,
      'Authorization': `Bearer ${user.accessTokenRef}`,
      'X-Tenant-ID': user.tenantId,
      'X-User-ID': user.sub,
      'X-Trace-ID': traceId,
      'X-User-Roles': user.roles.join(','),
      'X-Keyfront-Gateway': 'true',
      'Content-Type': originalHeaders['content-type'] || 'application/json',
      'User-Agent': 'Keyfront-BFF/1.0',
    };
  }

  private filterResponseHeaders(headers: Headers): Headers {
    // Headers to remove from downstream response
    const headersToRemove = [
      'connection',
      'upgrade',
      'keep-alive',
      'proxy-authenticate',
      'proxy-authorization',
      'te',
      'trailers',
      'transfer-encoding',
    ];

    const filteredHeaders = new Headers();
    
    headers.forEach((value, key) => {
      if (!headersToRemove.includes(key.toLowerCase())) {
        filteredHeaders.set(key, value);
      }
    });

    // Add CORS headers if needed
    if (!filteredHeaders.has('Access-Control-Allow-Origin')) {
      const allowedOrigins = process.env.CORS_ORIGINS?.split(',') || [];
      if (allowedOrigins.length > 0) {
        filteredHeaders.set('Access-Control-Allow-Origin', allowedOrigins[0]);
      }
    }

    return filteredHeaders;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Health check for downstream services
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000), // 5 second timeout
      });
      
      return response.ok;
    } catch (error) {
      console.error('Downstream health check failed:', error);
      return false;
    }
  }

  // Get service info
  getServiceInfo() {
    return {
      baseUrl: this.baseUrl,
      timeout: this.timeout,
      retryAttempts: this.retryAttempts,
      retryDelay: this.retryDelay,
    };
  }
}

// Singleton instance
export const proxyService = new ProxyService();