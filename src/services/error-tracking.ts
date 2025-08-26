import { redisService } from './redis';
import { tenantService } from './tenant';
import { generateTraceId } from '@/lib/tracing';
import { metricsCollector } from '@/lib/metrics';

export interface ErrorEvent {
  id: string;
  timestamp: string;
  traceId: string;
  tenantId: string;
  userId?: string;
  
  // Error details
  message: string;
  stack?: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  
  // Context
  context: {
    method?: string;
    url?: string;
    userAgent?: string;
    ip?: string;
    sessionId?: string;
    route?: string;
    statusCode?: number;
  };
  
  // Metadata
  tags: string[];
  fingerprint: string; // For grouping similar errors
  resolved: boolean;
  resolvedBy?: string;
  resolvedAt?: string;
  
  // Count for grouped errors
  count: number;
  firstSeen: string;
  lastSeen: string;
}

export interface ErrorGroup {
  fingerprint: string;
  message: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  count: number;
  affectedUsers: string[];
  firstSeen: string;
  lastSeen: string;
  resolved: boolean;
  tags: string[];
  sample: ErrorEvent;
}

export interface ErrorStats {
  totalErrors: number;
  newErrors: number;
  resolvedErrors: number;
  errorsByType: Record<string, number>;
  errorsBySeverity: Record<string, number>;
  errorsByTenant: Record<string, number>;
  topErrors: ErrorGroup[];
  recentErrors: ErrorEvent[];
  errorRate: {
    current: number;
    previous: number;
    change: number;
  };
}

export interface AlertRule {
  id: string;
  name: string;
  tenantId: string;
  enabled: boolean;
  
  conditions: {
    errorCount?: number;
    errorRate?: number;
    timeWindow: number; // minutes
    severity?: string[];
    errorTypes?: string[];
  };
  
  actions: {
    webhook?: {
      url: string;
      method: 'POST' | 'PUT';
      headers: Record<string, string>;
      body?: string;
    };
    email?: {
      recipients: string[];
      subject: string;
      template: string;
    };
  };
  
  metadata: {
    createdBy: string;
    createdAt: string;
    updatedBy: string;
    updatedAt: string;
  };
}

export class ErrorTrackingService {
  private readonly errorKeyPrefix = 'error:';
  private readonly groupKeyPrefix = 'error_group:';
  private readonly alertKeyPrefix = 'alert_rule:';
  private readonly statsKeyPrefix = 'error_stats:';
  
  private getErrorKey(errorId: string): string {
    return `${this.errorKeyPrefix}${errorId}`;
  }
  
  private getGroupKey(fingerprint: string): string {
    return `${this.groupKeyPrefix}${fingerprint}`;
  }
  
  private getAlertKey(alertId: string): string {
    return `${this.alertKeyPrefix}${alertId}`;
  }
  
  private getStatsKey(tenantId: string, date: string): string {
    return `${this.statsKeyPrefix}${tenantId}:${date}`;
  }
  
  private generateFingerprint(error: Partial<ErrorEvent>): string {
    const key = `${error.type}:${error.message}:${error.context?.route}`;
    return Buffer.from(key).toString('base64').substring(0, 16);
  }
  
  async recordError(errorData: Omit<ErrorEvent, 'id' | 'timestamp' | 'fingerprint' | 'count' | 'firstSeen' | 'lastSeen' | 'resolved'>): Promise<ErrorEvent> {
    const now = new Date().toISOString();
    const errorId = generateTraceId();
    const fingerprint = this.generateFingerprint(errorData);
    
    const error: ErrorEvent = {
      ...errorData,
      id: errorId,
      timestamp: now,
      fingerprint,
      count: 1,
      firstSeen: now,
      lastSeen: now,
      resolved: false,
    };
    
    try {
      // Store individual error
      await redisService.set(
        this.getErrorKey(errorId), 
        JSON.stringify(error),
        7 * 24 * 60 * 60 // 7 days TTL
      );
      
      // Update or create error group
      await this.updateErrorGroup(error);
      
      // Update statistics
      await this.updateErrorStats(error);
      
      // Record metrics
      await metricsCollector.incrementCounter(
        'errors_total',
        { 
          tenant_id: error.tenantId,
          error_type: error.type,
          severity: error.severity
        },
        1,
        'Total number of errors recorded'
      );
      
      // Check alert rules
      await this.checkAlertRules(error);
      
      return error;
    } catch (err) {
      console.error('Failed to record error:', err);
      throw err;
    }
  }
  
  private async updateErrorGroup(error: ErrorEvent): Promise<void> {
    const groupKey = this.getGroupKey(error.fingerprint);
    
    try {
      const existingGroupData = await redisService.get(groupKey);
      
      if (existingGroupData) {
        const group: ErrorGroup = JSON.parse(existingGroupData);
        group.count += 1;
        group.lastSeen = error.timestamp;
        
        // Add user to affected users list
        if (error.userId && !group.affectedUsers.includes(error.userId)) {
          group.affectedUsers.push(error.userId);
        }
        
        // Update sample with latest error
        group.sample = error;
        
        await redisService.set(groupKey, JSON.stringify(group), 30 * 24 * 60 * 60); // 30 days
      } else {
        // Create new group
        const group: ErrorGroup = {
          fingerprint: error.fingerprint,
          message: error.message,
          type: error.type,
          severity: error.severity,
          count: 1,
          affectedUsers: error.userId ? [error.userId] : [],
          firstSeen: error.timestamp,
          lastSeen: error.timestamp,
          resolved: false,
          tags: error.tags,
          sample: error,
        };
        
        await redisService.set(groupKey, JSON.stringify(group), 30 * 24 * 60 * 60); // 30 days
      }
    } catch (err) {
      console.error('Failed to update error group:', err);
    }
  }
  
  private async updateErrorStats(error: ErrorEvent): Promise<void> {
    const today = new Date().toISOString().substring(0, 10);
    const statsKey = this.getStatsKey(error.tenantId, today);
    
    try {
      const existingStatsData = await redisService.get(statsKey);
      let stats: any = existingStatsData ? JSON.parse(existingStatsData) : {
        date: today,
        tenantId: error.tenantId,
        totalErrors: 0,
        errorsByType: {},
        errorsBySeverity: {},
        errorsByHour: {},
      };
      
      stats.totalErrors += 1;
      stats.errorsByType[error.type] = (stats.errorsByType[error.type] || 0) + 1;
      stats.errorsBySeverity[error.severity] = (stats.errorsBySeverity[error.severity] || 0) + 1;
      
      const hour = new Date(error.timestamp).getHours();
      stats.errorsByHour[hour] = (stats.errorsByHour[hour] || 0) + 1;
      
      await redisService.set(statsKey, JSON.stringify(stats), 30 * 24 * 60 * 60); // 30 days
    } catch (err) {
      console.error('Failed to update error stats:', err);
    }
  }
  
  private async checkAlertRules(error: ErrorEvent): Promise<void> {
    try {
      const alertKeys = await redisService.getKeysByPattern(`${this.alertKeyPrefix}${error.tenantId}:*`);
      
      for (const alertKey of alertKeys) {
        const alertData = await redisService.get(alertKey);
        if (!alertData) continue;
        
        const rule: AlertRule = JSON.parse(alertData);
        if (!rule.enabled) continue;
        
        // Check conditions
        const shouldTrigger = await this.evaluateAlertConditions(rule, error);
        if (shouldTrigger) {
          await this.triggerAlert(rule, error);
        }
      }
    } catch (err) {
      console.error('Failed to check alert rules:', err);
    }
  }
  
  private async evaluateAlertConditions(rule: AlertRule, error: ErrorEvent): Promise<boolean> {
    const { conditions } = rule;
    
    // Check severity filter
    if (conditions.severity && !conditions.severity.includes(error.severity)) {
      return false;
    }
    
    // Check error type filter
    if (conditions.errorTypes && !conditions.errorTypes.includes(error.type)) {
      return false;
    }
    
    // Check error count in time window
    if (conditions.errorCount) {
      const windowStart = new Date(Date.now() - conditions.timeWindow * 60 * 1000).toISOString();
      const recentErrors = await this.getErrorsInTimeRange(error.tenantId, windowStart, error.timestamp);
      
      if (recentErrors.length < conditions.errorCount) {
        return false;
      }
    }
    
    return true;
  }
  
  private async triggerAlert(rule: AlertRule, error: ErrorEvent): Promise<void> {
    console.log(`Triggering alert: ${rule.name} for error: ${error.id}`);
    
    // Record alert metric
    await metricsCollector.incrementCounter(
      'alerts_triggered_total',
      {
        tenant_id: rule.tenantId,
        alert_rule: rule.name,
        severity: error.severity,
      },
      1,
      'Total number of alerts triggered'
    );
    
    // Execute alert actions
    if (rule.actions.webhook) {
      await this.sendWebhookAlert(rule.actions.webhook, rule, error);
    }
    
    if (rule.actions.email) {
      await this.sendEmailAlert(rule.actions.email, rule, error);
    }
  }
  
  private async sendWebhookAlert(webhook: AlertRule['actions']['webhook'], rule: AlertRule, error: ErrorEvent): Promise<void> {
    if (!webhook) return;
    
    try {
      const payload = {
        alert: rule.name,
        error: {
          id: error.id,
          message: error.message,
          type: error.type,
          severity: error.severity,
          timestamp: error.timestamp,
          traceId: error.traceId,
        },
        tenant: error.tenantId,
      };
      
      const response = await fetch(webhook.url, {
        method: webhook.method,
        headers: {
          'Content-Type': 'application/json',
          ...webhook.headers,
        },
        body: JSON.stringify(payload),
      });
      
      if (!response.ok) {
        console.error(`Webhook alert failed: ${response.status} ${response.statusText}`);
      }
    } catch (err) {
      console.error('Failed to send webhook alert:', err);
    }
  }
  
  private async sendEmailAlert(email: AlertRule['actions']['email'], rule: AlertRule, error: ErrorEvent): Promise<void> {
    if (!email) return;
    
    // Placeholder for email sending logic
    console.log(`Email alert would be sent to: ${email.recipients.join(', ')}`);
    console.log(`Subject: ${email.subject}`);
    console.log(`Error: ${error.message}`);
  }
  
  async getErrorsInTimeRange(tenantId: string, startTime: string, endTime: string): Promise<ErrorEvent[]> {
    try {
      const allErrorKeys = await redisService.getKeysByPattern(`${this.errorKeyPrefix}*`);
      const errors: ErrorEvent[] = [];
      
      for (const key of allErrorKeys) {
        const errorData = await redisService.get(key);
        if (!errorData) continue;
        
        const error: ErrorEvent = JSON.parse(errorData);
        
        if (error.tenantId === tenantId && 
            error.timestamp >= startTime && 
            error.timestamp <= endTime) {
          errors.push(error);
        }
      }
      
      return errors.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    } catch (err) {
      console.error('Failed to get errors in time range:', err);
      return [];
    }
  }
  
  async getErrorGroups(tenantId: string, limit: number = 50): Promise<ErrorGroup[]> {
    try {
      const groupKeys = await redisService.getKeysByPattern(`${this.groupKeyPrefix}*`);
      const groups: ErrorGroup[] = [];
      
      for (const key of groupKeys) {
        const groupData = await redisService.get(key);
        if (!groupData) continue;
        
        const group: ErrorGroup = JSON.parse(groupData);
        if (group.sample.tenantId === tenantId) {
          groups.push(group);
        }
      }
      
      return groups
        .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))
        .slice(0, limit);
    } catch (err) {
      console.error('Failed to get error groups:', err);
      return [];
    }
  }
  
  async resolveErrorGroup(fingerprint: string, resolvedBy: string): Promise<boolean> {
    try {
      const groupKey = this.getGroupKey(fingerprint);
      const groupData = await redisService.get(groupKey);
      
      if (!groupData) return false;
      
      const group: ErrorGroup = JSON.parse(groupData);
      group.resolved = true;
      group.sample.resolved = true;
      group.sample.resolvedBy = resolvedBy;
      group.sample.resolvedAt = new Date().toISOString();
      
      await redisService.set(groupKey, JSON.stringify(group), 30 * 24 * 60 * 60);
      return true;
    } catch (err) {
      console.error('Failed to resolve error group:', err);
      return false;
    }
  }
  
  async getErrorStats(tenantId: string, days: number = 7): Promise<ErrorStats> {
    try {
      const stats: ErrorStats = {
        totalErrors: 0,
        newErrors: 0,
        resolvedErrors: 0,
        errorsByType: {},
        errorsBySeverity: {},
        errorsByTenant: {},
        topErrors: [],
        recentErrors: [],
        errorRate: { current: 0, previous: 0, change: 0 },
      };
      
      // Get recent errors
      const endTime = new Date().toISOString();
      const startTime = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      
      const recentErrors = await this.getErrorsInTimeRange(tenantId, startTime, endTime);
      stats.recentErrors = recentErrors.slice(0, 20);
      stats.totalErrors = recentErrors.length;
      
      // Count by type and severity
      recentErrors.forEach(error => {
        stats.errorsByType[error.type] = (stats.errorsByType[error.type] || 0) + 1;
        stats.errorsBySeverity[error.severity] = (stats.errorsBySeverity[error.severity] || 0) + 1;
        
        if (!error.resolved) {
          stats.newErrors++;
        } else {
          stats.resolvedErrors++;
        }
      });
      
      // Get top error groups
      stats.topErrors = await this.getErrorGroups(tenantId, 10);
      
      return stats;
    } catch (err) {
      console.error('Failed to get error stats:', err);
      return {
        totalErrors: 0,
        newErrors: 0,
        resolvedErrors: 0,
        errorsByType: {},
        errorsBySeverity: {},
        errorsByTenant: {},
        topErrors: [],
        recentErrors: [],
        errorRate: { current: 0, previous: 0, change: 0 },
      };
    }
  }
}

export const errorTracker = new ErrorTrackingService();