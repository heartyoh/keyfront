import { v4 as uuidv4 } from 'uuid';

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  timestamp: number;
  operation: string;
  metadata?: Record<string, any>;
}

export class TracingService {
  private static instance: TracingService;
  private traces: Map<string, TraceContext[]> = new Map();

  static getInstance(): TracingService {
    if (!TracingService.instance) {
      TracingService.instance = new TracingService();
    }
    return TracingService.instance;
  }

  generateTraceId(): string {
    // Generate a more readable trace ID
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `keyfront_${timestamp}_${random}`;
  }

  generateSpanId(): string {
    return Math.random().toString(36).substring(2, 10);
  }

  startTrace(operation: string, metadata?: Record<string, any>): TraceContext {
    const traceId = this.generateTraceId();
    const spanId = this.generateSpanId();
    
    const context: TraceContext = {
      traceId,
      spanId,
      timestamp: Date.now(),
      operation,
      metadata,
    };

    if (!this.traces.has(traceId)) {
      this.traces.set(traceId, []);
    }
    this.traces.get(traceId)!.push(context);

    console.log(`🔍 [TRACE START] ${traceId} - ${operation}`, metadata);
    return context;
  }

  startSpan(
    traceId: string, 
    operation: string, 
    parentSpanId?: string,
    metadata?: Record<string, any>
  ): TraceContext {
    const spanId = this.generateSpanId();
    
    const context: TraceContext = {
      traceId,
      spanId,
      parentSpanId,
      timestamp: Date.now(),
      operation,
      metadata,
    };

    if (!this.traces.has(traceId)) {
      this.traces.set(traceId, []);
    }
    this.traces.get(traceId)!.push(context);

    console.log(`🔗 [SPAN START] ${traceId}:${spanId} - ${operation}`, metadata);
    return context;
  }

  finishSpan(
    traceId: string, 
    spanId: string, 
    metadata?: Record<string, any>
  ): void {
    const spans = this.traces.get(traceId);
    if (spans) {
      const span = spans.find(s => s.spanId === spanId);
      if (span) {
        const duration = Date.now() - span.timestamp;
        console.log(`✅ [SPAN END] ${traceId}:${spanId} - ${span.operation} (${duration}ms)`, metadata);
      }
    }
  }

  addEvent(
    traceId: string, 
    event: string, 
    metadata?: Record<string, any>
  ): void {
    console.log(`📝 [TRACE EVENT] ${traceId} - ${event}`, metadata);
  }

  getTrace(traceId: string): TraceContext[] | undefined {
    return this.traces.get(traceId);
  }

  cleanup(maxAge: number = 300000): void {
    // Clean up traces older than maxAge milliseconds (default: 5 minutes)
    const cutoff = Date.now() - maxAge;
    
    for (const [traceId, spans] of this.traces.entries()) {
      if (spans.length > 0 && spans[0].timestamp < cutoff) {
        this.traces.delete(traceId);
      }
    }
  }

  // Extract trace ID from headers
  extractTraceId(headers: Headers | Record<string, string>): string | undefined {
    const headersObj = headers instanceof Headers 
      ? Object.fromEntries(headers.entries())
      : headers;

    return headersObj['x-trace-id'] || 
           headersObj['x-keyfront-trace-id'] || 
           headersObj['traceparent']?.split('-')[1];
  }

  // Inject trace ID into headers
  injectTraceId(headers: Record<string, string>, traceId: string): void {
    headers['x-keyfront-trace-id'] = traceId;
    // W3C Trace Context format (simplified)
    headers['traceparent'] = `00-${traceId.replace(/[^a-f0-9]/g, '').padEnd(32, '0')}-${this.generateSpanId().padEnd(16, '0')}-01`;
  }
}

// Singleton instance
export const tracingService = TracingService.getInstance();

// Utility functions
export function generateTraceId(): string {
  return tracingService.generateTraceId();
}

export function startTrace(operation: string, metadata?: Record<string, any>): TraceContext {
  return tracingService.startTrace(operation, metadata);
}

export function startSpan(
  traceId: string, 
  operation: string, 
  parentSpanId?: string,
  metadata?: Record<string, any>
): TraceContext {
  return tracingService.startSpan(traceId, operation, parentSpanId, metadata);
}

export function finishSpan(traceId: string, spanId: string, metadata?: Record<string, any>): void {
  return tracingService.finishSpan(traceId, spanId, metadata);
}

export function addTraceEvent(traceId: string, event: string, metadata?: Record<string, any>): void {
  return tracingService.addEvent(traceId, event, metadata);
}

// Middleware helper for automatic tracing
export function withTracing<T extends (...args: any[]) => Promise<any>>(
  operation: string,
  fn: T
): T {
  return (async (...args: any[]) => {
    const trace = startTrace(operation, { args: args.map(arg => typeof arg) });
    
    try {
      const result = await fn(...args);
      finishSpan(trace.traceId, trace.spanId, { success: true });
      return result;
    } catch (error) {
      finishSpan(trace.traceId, trace.spanId, { 
        success: false, 
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }) as T;
}

// Clean up old traces periodically
setInterval(() => {
  tracingService.cleanup();
}, 60000); // Clean up every minute