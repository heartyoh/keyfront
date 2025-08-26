import { redisService } from '@/services/redis';
import { generateTraceId } from './tracing';

export interface MetricLabels {
  [key: string]: string | number;
}

export interface Metric {
  name: string;
  value: number;
  type: 'counter' | 'gauge' | 'histogram' | 'summary';
  help: string;
  labels?: MetricLabels;
  timestamp?: number;
}

export interface HistogramBucket {
  le: string; // less than or equal
  count: number;
}

export interface HistogramMetric extends Metric {
  type: 'histogram';
  buckets: HistogramBucket[];
  sum: number;
  count: number;
}

export interface CounterMetric extends Metric {
  type: 'counter';
}

export interface GaugeMetric extends Metric {
  type: 'gauge';
}

export class MetricsCollector {
  private metrics: Map<string, Metric> = new Map();
  private histogramBuckets = [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1.0, 2.5, 5.0, 7.5, 10.0];

  /**
   * Increment a counter metric
   */
  async incrementCounter(
    name: string,
    labels: MetricLabels = {},
    value: number = 1,
    help?: string
  ): Promise<void> {
    const metricKey = this.getMetricKey(name, labels);
    const existing = this.metrics.get(metricKey) as CounterMetric;

    const metric: CounterMetric = {
      name,
      value: existing ? existing.value + value : value,
      type: 'counter',
      help: help || existing?.help || `Counter metric for ${name}`,
      labels,
      timestamp: Date.now(),
    };

    this.metrics.set(metricKey, metric);
    
    // Persist to Redis for aggregation across instances
    await this.persistMetric(metricKey, metric);
  }

  /**
   * Set a gauge metric value
   */
  async setGauge(
    name: string,
    value: number,
    labels: MetricLabels = {},
    help?: string
  ): Promise<void> {
    const metricKey = this.getMetricKey(name, labels);
    
    const metric: GaugeMetric = {
      name,
      value,
      type: 'gauge',
      help: help || `Gauge metric for ${name}`,
      labels,
      timestamp: Date.now(),
    };

    this.metrics.set(metricKey, metric);
    await this.persistMetric(metricKey, metric);
  }

  /**
   * Observe a histogram metric
   */
  async observeHistogram(
    name: string,
    value: number,
    labels: MetricLabels = {},
    help?: string
  ): Promise<void> {
    const metricKey = this.getMetricKey(name, labels);
    const existing = this.metrics.get(metricKey) as HistogramMetric;

    // Initialize buckets if not exists
    const buckets: HistogramBucket[] = existing?.buckets || 
      this.histogramBuckets.map(le => ({ le: le.toString(), count: 0 }));

    // Update bucket counts
    buckets.forEach(bucket => {
      if (value <= parseFloat(bucket.le)) {
        bucket.count++;
      }
    });

    const metric: HistogramMetric = {
      name,
      value, // Current observation
      type: 'histogram',
      help: help || existing?.help || `Histogram metric for ${name}`,
      labels,
      buckets,
      sum: (existing?.sum || 0) + value,
      count: (existing?.count || 0) + 1,
      timestamp: Date.now(),
    };

    this.metrics.set(metricKey, metric);
    await this.persistMetric(metricKey, metric);
  }

  /**
   * Record request duration
   */
  async recordRequestDuration(
    method: string,
    endpoint: string,
    statusCode: number,
    duration: number,
    labels: MetricLabels = {}
  ): Promise<void> {
    const baseLabels = {
      method,
      endpoint,
      status_code: statusCode.toString(),
      ...labels,
    };

    // Counter for total requests
    await this.incrementCounter(
      'http_requests_total',
      baseLabels,
      1,
      'Total number of HTTP requests'
    );

    // Histogram for request duration
    await this.observeHistogram(
      'http_request_duration_seconds',
      duration / 1000, // Convert ms to seconds
      baseLabels,
      'HTTP request duration in seconds'
    );

    // Gauge for active requests (this would need separate tracking)
    // await this.setGauge('http_active_requests', activeCount, baseLabels);
  }

  /**
   * Record WebSocket metrics
   */
  async recordWebSocketMetrics(
    event: 'connect' | 'disconnect' | 'message_sent' | 'message_received',
    labels: MetricLabels = {}
  ): Promise<void> {
    const baseLabels = { event, ...labels };

    await this.incrementCounter(
      'websocket_events_total',
      baseLabels,
      1,
      'Total number of WebSocket events'
    );

    if (event === 'connect') {
      // This would need actual connection counting
      // await this.incrementGauge('websocket_active_connections', baseLabels, 1);
    } else if (event === 'disconnect') {
      // await this.incrementGauge('websocket_active_connections', baseLabels, -1);
    }
  }

  /**
   * Record authentication metrics
   */
  async recordAuthMetrics(
    event: 'login_attempt' | 'login_success' | 'login_failure' | 'logout' | 'token_refresh',
    labels: MetricLabels = {}
  ): Promise<void> {
    const baseLabels = { event, ...labels };

    await this.incrementCounter(
      'auth_events_total',
      baseLabels,
      1,
      'Total number of authentication events'
    );
  }

  /**
   * Record security metrics
   */
  async recordSecurityMetrics(
    threatType: string,
    severity: string,
    blocked: boolean,
    labels: MetricLabels = {}
  ): Promise<void> {
    const baseLabels = {
      threat_type: threatType,
      severity,
      blocked: blocked.toString(),
      ...labels,
    };

    await this.incrementCounter(
      'security_threats_total',
      baseLabels,
      1,
      'Total number of security threats detected'
    );
  }

  /**
   * Get all metrics in Prometheus format
   */
  getPrometheusMetrics(): string {
    const metricGroups: Map<string, Metric[]> = new Map();

    // Group metrics by name
    this.metrics.forEach(metric => {
      const existing = metricGroups.get(metric.name) || [];
      existing.push(metric);
      metricGroups.set(metric.name, existing);
    });

    const output: string[] = [];

    metricGroups.forEach((metrics, name) => {
      const firstMetric = metrics[0];
      
      // Add help comment
      output.push(`# HELP ${name} ${firstMetric.help}`);
      output.push(`# TYPE ${name} ${firstMetric.type}`);

      metrics.forEach(metric => {
        const labelStr = this.formatLabels(metric.labels);
        
        if (metric.type === 'histogram') {
          const histMetric = metric as HistogramMetric;
          
          // Bucket metrics
          histMetric.buckets.forEach(bucket => {
            output.push(`${name}_bucket{${labelStr}${labelStr ? ',' : ''}le="${bucket.le}"} ${bucket.count}`);
          });
          
          // Sum and count
          output.push(`${name}_sum{${labelStr}} ${histMetric.sum}`);
          output.push(`${name}_count{${labelStr}} ${histMetric.count}`);
        } else {
          output.push(`${name}{${labelStr}} ${metric.value}`);
        }
      });

      output.push(''); // Empty line between metrics
    });

    return output.join('\n');
  }

  /**
   * Get metrics summary
   */
  getMetricsSummary(): {
    totalMetrics: number;
    metricsByType: Record<string, number>;
    lastUpdated: string;
    topMetrics: Array<{ name: string; value: number; type: string }>;
  } {
    const metricsByType: Record<string, number> = {};
    const sortedMetrics: Array<{ name: string; value: number; type: string }> = [];

    this.metrics.forEach(metric => {
      metricsByType[metric.type] = (metricsByType[metric.type] || 0) + 1;
      sortedMetrics.push({
        name: metric.name,
        value: metric.value,
        type: metric.type,
      });
    });

    // Sort by value (for counters mainly)
    sortedMetrics.sort((a, b) => b.value - a.value);

    return {
      totalMetrics: this.metrics.size,
      metricsByType,
      lastUpdated: new Date().toISOString(),
      topMetrics: sortedMetrics.slice(0, 10),
    };
  }

  /**
   * Clear all metrics
   */
  clearMetrics(): void {
    this.metrics.clear();
  }

  /**
   * Clear old metrics (older than specified age)
   */
  clearOldMetrics(maxAgeMs: number): void {
    const cutoff = Date.now() - maxAgeMs;
    
    this.metrics.forEach((metric, key) => {
      if (metric.timestamp && metric.timestamp < cutoff) {
        this.metrics.delete(key);
      }
    });
  }

  private getMetricKey(name: string, labels: MetricLabels): string {
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}="${value}"`)
      .join(',');
    
    return `${name}{${labelStr}}`;
  }

  private formatLabels(labels?: MetricLabels): string {
    if (!labels || Object.keys(labels).length === 0) {
      return '';
    }

    return Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}="${value}"`)
      .join(',');
  }

  private async persistMetric(key: string, metric: Metric): Promise<void> {
    try {
      // Store in Redis with TTL for aggregation
      const redisKey = `metrics:${key}`;
      await redisService.set(redisKey, JSON.stringify(metric), 3600); // 1 hour TTL
    } catch (error) {
      console.error('Failed to persist metric:', error);
      // Don't throw - metrics should be best effort
    }
  }
}

/**
 * Middleware to automatically collect HTTP metrics
 */
export function withMetrics<T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  metricName?: string
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    const startTime = Date.now();
    const traceId = generateTraceId();
    
    try {
      const result = await fn(...args);
      const duration = Date.now() - startTime;
      
      // Record success metrics
      await metricsCollector.observeHistogram(
        metricName || 'function_duration_seconds',
        duration / 1000,
        { status: 'success', trace_id: traceId },
        `Duration of ${fn.name || 'function'} execution`
      );
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Record error metrics
      await metricsCollector.incrementCounter(
        'function_errors_total',
        { 
          function: fn.name || 'unknown',
          error_type: error instanceof Error ? error.constructor.name : 'unknown',
          trace_id: traceId 
        },
        1,
        'Total number of function errors'
      );
      
      await metricsCollector.observeHistogram(
        metricName || 'function_duration_seconds',
        duration / 1000,
        { status: 'error', trace_id: traceId }
      );
      
      throw error;
    }
  };
}

// Global metrics collector instance
export const metricsCollector = new MetricsCollector();

// Built-in system metrics collection
export async function collectSystemMetrics(): Promise<void> {
  try {
    const memUsage = process.memoryUsage();
    
    await metricsCollector.setGauge(
      'nodejs_memory_usage_bytes',
      memUsage.heapUsed,
      { type: 'heap_used' },
      'Node.js memory usage in bytes'
    );
    
    await metricsCollector.setGauge(
      'nodejs_memory_usage_bytes',
      memUsage.heapTotal,
      { type: 'heap_total' }
    );
    
    await metricsCollector.setGauge(
      'nodejs_memory_usage_bytes',
      memUsage.rss,
      { type: 'rss' }
    );
    
    await metricsCollector.setGauge(
      'nodejs_memory_usage_bytes',
      memUsage.external,
      { type: 'external' }
    );

    // Process uptime
    await metricsCollector.setGauge(
      'nodejs_process_uptime_seconds',
      process.uptime(),
      {},
      'Node.js process uptime in seconds'
    );

  } catch (error) {
    console.error('Failed to collect system metrics:', error);
  }
}

// Auto-collect system metrics every 15 seconds
setInterval(collectSystemMetrics, 15000);