import { AuditLog } from '@/types/common';
import { redisService } from '@/services/redis';

export interface AuditEvent {
  traceId: string;
  tenantId: string;
  userId: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  result: 'allow' | 'deny' | 'error';
  reason?: string;
  metadata?: Record<string, any>;
}

export class AuditLogger {
  private readonly queueKey = 'audit:queue';
  private readonly batchSize = 100;
  private readonly flushInterval = 5000; // 5 seconds
  private pending: AuditEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;

  constructor() {
    // Start the flush timer
    this.startFlushTimer();
  }

  async log(event: AuditEvent): Promise<void> {
    try {
      // Add timestamp and ID
      const auditLog: AuditLog = {
        id: this.generateLogId(),
        timestamp: new Date(),
        traceId: event.traceId,
        tenantId: event.tenantId,
        userId: event.userId,
        action: event.action,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        result: event.result,
        reason: event.reason,
        metadata: {
          ...event.metadata,
          timestamp: Date.now(),
          environment: process.env.NODE_ENV || 'development',
        },
      };

      // Add to pending queue
      this.pending.push(event);

      // Immediate console logging for development
      this.logToConsole(auditLog);

      // Flush if batch is full
      if (this.pending.length >= this.batchSize) {
        await this.flush();
      }

    } catch (error) {
      console.error('Failed to log audit event:', error);
      // Don't throw - audit logging should not break the main flow
    }
  }

  private async flush(): Promise<void> {
    if (this.pending.length === 0) return;

    const events = [...this.pending];
    this.pending = [];

    try {
      // Store in Redis queue for background processing
      if (events.length > 0) {
        const serialized = events.map(event => JSON.stringify(event));
        await redisService.pushToQueue(this.queueKey, serialized);
      }

      console.log(`📊 Flushed ${events.length} audit events to queue`);
    } catch (error) {
      console.error('Failed to flush audit events:', error);
      // Re-add events to pending queue for retry
      this.pending.unshift(...events);
    }
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(async () => {
      await this.flush();
    }, this.flushInterval);
  }

  private logToConsole(auditLog: AuditLog): void {
    const emoji = this.getResultEmoji(auditLog.result);
    const level = auditLog.result === 'error' ? 'error' : 
                  auditLog.result === 'deny' ? 'warn' : 'info';

    console[level](`${emoji} [AUDIT] ${auditLog.tenantId}/${auditLog.userId} - ${auditLog.action} ${auditLog.resourceType}${auditLog.resourceId ? `/${auditLog.resourceId}` : ''} - ${auditLog.result.toUpperCase()}`, {
      traceId: auditLog.traceId,
      reason: auditLog.reason,
      metadata: auditLog.metadata,
    });
  }

  private getResultEmoji(result: string): string {
    switch (result) {
      case 'allow': return '✅';
      case 'deny': return '❌';
      case 'error': return '💥';
      default: return '📝';
    }
  }

  private generateLogId(): string {
    // Generate sortable ID: timestamp + random
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${timestamp}_${random}`;
  }

  // Get audit logs for a specific tenant (for admin UI)
  async getAuditLogs(
    tenantId: string, 
    filters?: {
      userId?: string;
      action?: string;
      resourceType?: string;
      result?: string;
      fromDate?: Date;
      toDate?: Date;
      limit?: number;
      offset?: number;
    }
  ): Promise<AuditLog[]> {
    // This would typically query a database
    // For now, we'll return from Redis queue (limited functionality)
    try {
      const events = await redisService.getFromQueue(this.queueKey, filters?.limit || 100);
      return events
        .map(event => JSON.parse(event))
        .filter(event => event.tenantId === tenantId)
        .filter(event => !filters?.userId || event.userId === filters.userId)
        .filter(event => !filters?.action || event.action === filters.action)
        .filter(event => !filters?.resourceType || event.resourceType === filters.resourceType)
        .filter(event => !filters?.result || event.result === filters.result);
    } catch (error) {
      console.error('Failed to get audit logs:', error);
      return [];
    }
  }

  // Export audit logs (for compliance)
  async exportAuditLogs(
    tenantId: string,
    format: 'json' | 'csv' = 'json',
    filters?: {
      fromDate?: Date;
      toDate?: Date;
    }
  ): Promise<string> {
    const logs = await this.getAuditLogs(tenantId, filters);
    
    if (format === 'csv') {
      return this.convertToCSV(logs);
    }
    
    return JSON.stringify(logs, null, 2);
  }

  private convertToCSV(logs: AuditLog[]): string {
    if (logs.length === 0) return '';

    const headers = [
      'id', 'timestamp', 'traceId', 'tenantId', 'userId', 
      'action', 'resourceType', 'resourceId', 'result', 'reason'
    ];

    const rows = logs.map(log => [
      log.id,
      log.timestamp.toISOString(),
      log.traceId,
      log.tenantId,
      log.userId,
      log.action,
      log.resourceType,
      log.resourceId || '',
      log.result,
      log.reason || ''
    ]);

    return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  }

  // Cleanup old audit logs
  async cleanup(maxAge: number = 2592000000): Promise<number> {
    // Default: 30 days in milliseconds
    const cutoff = new Date(Date.now() - maxAge);
    
    // This would typically clean up from database
    // For now, just log the cleanup operation
    console.log(`🧹 Audit log cleanup requested for logs older than ${cutoff.toISOString()}`);
    return 0;
  }

  // Graceful shutdown
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    
    // Flush remaining events
    await this.flush();
    console.log('📊 Audit logger shutdown complete');
  }
}

// Singleton instance
export const auditLogger = new AuditLogger();

// Helper functions for common audit events
export const auditEvents = {
  async login(traceId: string, tenantId: string, userId: string, result: 'allow' | 'deny', reason?: string, metadata?: any) {
    return auditLogger.log({
      traceId,
      tenantId,
      userId,
      action: 'login',
      resourceType: 'auth',
      result,
      reason,
      metadata,
    });
  },

  async logout(traceId: string, tenantId: string, userId: string, metadata?: any) {
    return auditLogger.log({
      traceId,
      tenantId,
      userId,
      action: 'logout',
      resourceType: 'auth',
      result: 'allow',
      metadata,
    });
  },

  async tokenRefresh(traceId: string, tenantId: string, userId: string, result: 'allow' | 'error', reason?: string, metadata?: any) {
    return auditLogger.log({
      traceId,
      tenantId,
      userId,
      action: 'token_refresh',
      resourceType: 'auth',
      result,
      reason,
      metadata,
    });
  },

  async apiAccess(traceId: string, tenantId: string, userId: string, method: string, path: string, result: 'allow' | 'deny' | 'error', reason?: string, metadata?: any) {
    return auditLogger.log({
      traceId,
      tenantId,
      userId,
      action: `api_${method.toLowerCase()}`,
      resourceType: 'api',
      resourceId: path,
      result,
      reason,
      metadata,
    });
  },

  async rateLimitHit(traceId: string, tenantId: string, userId: string, rateLimitType: string, metadata?: any) {
    return auditLogger.log({
      traceId,
      tenantId,
      userId,
      action: 'rate_limit_exceeded',
      resourceType: 'rate_limit',
      resourceId: rateLimitType,
      result: 'deny',
      reason: 'Rate limit exceeded',
      metadata,
    });
  },
};

// Graceful shutdown handler
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down audit logger...');
  await auditLogger.shutdown();
});

process.on('SIGINT', async () => {
  console.log('Received SIGINT, shutting down audit logger...');
  await auditLogger.shutdown();
});