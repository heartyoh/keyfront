import { redisService } from './redis';
import { generateTraceId } from '@/lib/tracing';
import { 
  TenantConfiguration, 
  TenantConfigurationUpdate, 
  TenantConfigurationQuery,
  TenantUsageStats
} from '@/types/tenant';

export class TenantService {
  private readonly keyPrefix = 'tenant:config:';
  private readonly usageKeyPrefix = 'tenant:usage:';
  
  private getConfigKey(tenantId: string): string {
    return `${this.keyPrefix}${tenantId}`;
  }
  
  private getUsageKey(tenantId: string, date: string): string {
    return `${this.usageKeyPrefix}${tenantId}:${date}`;
  }
  
  private createDefaultConfig(tenantId: string, createdBy: string): TenantConfiguration {
    const now = new Date().toISOString();
    
    return {
      id: generateTraceId(),
      tenantId,
      name: `Tenant ${tenantId}`,
      
      corsConfig: {
        origins: ['http://localhost:3000'],
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
        exposedHeaders: ['X-Total-Count', 'X-RateLimit-Remaining'],
        credentials: true,
        maxAge: 86400,
      },
      
      rateLimits: {
        perMinute: 100,
        perHour: 5000,
        perDay: 50000,
        burst: 200,
        whitelistIps: [],
        blacklistIps: [],
      },
      
      security: {
        enableCsrfProtection: true,
        sessionTimeout: 3600,
        maxConcurrentSessions: 10,
        requireSecureHeaders: true,
        enableStrictTransportSecurity: true,
      },
      
      features: {
        enableAuditLogging: true,
        enableMetricsCollection: true,
        enableWebSocketSupport: true,
        enableAdvancedAuth: false,
        enableCustomHeaders: false,
      },
      
      proxyConfig: {
        baseUrl: process.env.DOWNSTREAM_API_BASE || 'http://localhost:4000',
        timeout: 30000,
        retries: 3,
        retryDelay: 1000,
        enableCircuitBreaker: true,
        circuitBreakerThreshold: 5,
        customHeaders: {},
      },
      
      notifications: {
        enableSecurityAlerts: true,
        enableErrorNotifications: true,
        enableUsageAlerts: false,
        emailRecipients: [],
      },
      
      metadata: {
        createdBy,
        createdAt: now,
        updatedBy: createdBy,
        updatedAt: now,
        version: 1,
        tags: [],
      },
      
      status: 'active',
    };
  }
  
  async getConfiguration(tenantId: string): Promise<TenantConfiguration | null> {
    try {
      const configData = await redisService.get(this.getConfigKey(tenantId));
      if (!configData) {
        return null;
      }
      
      return JSON.parse(configData) as TenantConfiguration;
    } catch (error) {
      console.error(`Failed to get tenant configuration for ${tenantId}:`, error);
      return null;
    }
  }
  
  async createConfiguration(
    tenantId: string, 
    createdBy: string,
    overrides?: Partial<TenantConfiguration>
  ): Promise<TenantConfiguration> {
    const config = this.createDefaultConfig(tenantId, createdBy);
    
    if (overrides) {
      Object.assign(config, overrides);
      config.metadata.updatedAt = new Date().toISOString();
      config.metadata.updatedBy = createdBy;
    }
    
    await redisService.set(
      this.getConfigKey(tenantId), 
      JSON.stringify(config),
      24 * 60 * 60 // 24 hours TTL
    );
    
    return config;
  }
  
  async updateConfiguration(
    tenantId: string, 
    updates: TenantConfigurationUpdate,
    updatedBy: string
  ): Promise<TenantConfiguration | null> {
    const existingConfig = await this.getConfiguration(tenantId);
    if (!existingConfig) {
      return null;
    }
    
    const updatedConfig: TenantConfiguration = {
      ...existingConfig,
      ...updates,
      metadata: {
        ...existingConfig.metadata,
        updatedBy,
        updatedAt: new Date().toISOString(),
        version: existingConfig.metadata.version + 1,
      },
    };
    
    // Deep merge for nested objects
    if (updates.corsConfig) {
      updatedConfig.corsConfig = { ...existingConfig.corsConfig, ...updates.corsConfig };
    }
    if (updates.rateLimits) {
      updatedConfig.rateLimits = { ...existingConfig.rateLimits, ...updates.rateLimits };
    }
    if (updates.security) {
      updatedConfig.security = { ...existingConfig.security, ...updates.security };
    }
    if (updates.features) {
      updatedConfig.features = { ...existingConfig.features, ...updates.features };
    }
    if (updates.proxyConfig) {
      updatedConfig.proxyConfig = { ...existingConfig.proxyConfig, ...updates.proxyConfig };
    }
    if (updates.notifications) {
      updatedConfig.notifications = { ...existingConfig.notifications, ...updates.notifications };
    }
    
    await redisService.set(
      this.getConfigKey(tenantId), 
      JSON.stringify(updatedConfig),
      24 * 60 * 60 // 24 hours TTL
    );
    
    return updatedConfig;
  }
  
  async deleteConfiguration(tenantId: string): Promise<boolean> {
    try {
      const deleted = await redisService.delete(this.getConfigKey(tenantId));
      return deleted > 0;
    } catch (error) {
      console.error(`Failed to delete tenant configuration for ${tenantId}:`, error);
      return false;
    }
  }
  
  async listConfigurations(query: TenantConfigurationQuery = {}): Promise<{
    configs: TenantConfiguration[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    try {
      const keys = await redisService.getKeysByPattern(`${this.keyPrefix}*`);
      const allConfigs: TenantConfiguration[] = [];
      
      for (const key of keys) {
        try {
          const configData = await redisService.get(key);
          if (configData) {
            const config = JSON.parse(configData) as TenantConfiguration;
            allConfigs.push(config);
          }
        } catch (error) {
          console.error(`Failed to parse config from key ${key}:`, error);
        }
      }
      
      // Apply filters
      let filteredConfigs = allConfigs.filter(config => {
        if (query.status && config.status !== query.status) return false;
        if (query.search) {
          const searchLower = query.search.toLowerCase();
          if (!config.name.toLowerCase().includes(searchLower) && 
              !config.tenantId.toLowerCase().includes(searchLower)) {
            return false;
          }
        }
        if (query.tags && query.tags.length > 0) {
          if (!query.tags.some(tag => config.metadata.tags.includes(tag))) {
            return false;
          }
        }
        return true;
      });
      
      // Apply sorting
      const sortBy = query.sortBy || 'updatedAt';
      const sortOrder = query.sortOrder || 'desc';
      
      filteredConfigs.sort((a, b) => {
        let aVal: string | number;
        let bVal: string | number;
        
        switch (sortBy) {
          case 'name':
            aVal = a.name;
            bVal = b.name;
            break;
          case 'createdAt':
            aVal = a.metadata.createdAt;
            bVal = b.metadata.createdAt;
            break;
          case 'updatedAt':
          default:
            aVal = a.metadata.updatedAt;
            bVal = b.metadata.updatedAt;
            break;
        }
        
        if (sortOrder === 'asc') {
          return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        } else {
          return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
        }
      });
      
      // Apply pagination
      const page = query.page || 1;
      const limit = Math.min(query.limit || 20, 100);
      const startIndex = (page - 1) * limit;
      const paginatedConfigs = filteredConfigs.slice(startIndex, startIndex + limit);
      
      return {
        configs: paginatedConfigs,
        total: filteredConfigs.length,
        page,
        totalPages: Math.ceil(filteredConfigs.length / limit),
      };
    } catch (error) {
      console.error('Failed to list tenant configurations:', error);
      return {
        configs: [],
        total: 0,
        page: 1,
        totalPages: 0,
      };
    }
  }
  
  async recordUsage(
    tenantId: string, 
    type: 'request' | 'error' | 'bandwidth',
    data: any
  ): Promise<void> {
    try {
      const today = new Date().toISOString().substring(0, 10); // YYYY-MM-DD
      const usageKey = this.getUsageKey(tenantId, today);
      
      const existingUsage = await redisService.get(usageKey);
      let usage: any = existingUsage ? JSON.parse(existingUsage) : {
        tenantId,
        date: today,
        requests: { total: 0, successful: 0, failed: 0, rateLimited: 0 },
        bandwidth: { inbound: 0, outbound: 0 },
        sessions: { total: 0, active: 0, peak: 0 },
        errors: { total: 0, byType: {} },
      };
      
      switch (type) {
        case 'request':
          usage.requests.total++;
          if (data.success) {
            usage.requests.successful++;
          } else if (data.rateLimited) {
            usage.requests.rateLimited++;
          } else {
            usage.requests.failed++;
          }
          break;
          
        case 'error':
          usage.errors.total++;
          const errorType = data.type || 'unknown';
          usage.errors.byType[errorType] = (usage.errors.byType[errorType] || 0) + 1;
          break;
          
        case 'bandwidth':
          if (data.inbound) usage.bandwidth.inbound += data.inbound;
          if (data.outbound) usage.bandwidth.outbound += data.outbound;
          break;
      }
      
      // Set with 7-day TTL for usage data
      await redisService.set(usageKey, JSON.stringify(usage), 7 * 24 * 60 * 60);
    } catch (error) {
      console.error(`Failed to record usage for tenant ${tenantId}:`, error);
    }
  }
  
  async getUsageStats(tenantId: string, days: number = 7): Promise<TenantUsageStats[]> {
    try {
      const stats: TenantUsageStats[] = [];
      
      for (let i = 0; i < days; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().substring(0, 10);
        
        const usageData = await redisService.get(this.getUsageKey(tenantId, dateStr));
        if (usageData) {
          const usage = JSON.parse(usageData);
          stats.push({
            tenantId,
            period: {
              start: `${dateStr}T00:00:00.000Z`,
              end: `${dateStr}T23:59:59.999Z`,
            },
            requests: usage.requests,
            bandwidth: usage.bandwidth,
            sessions: usage.sessions,
            errors: usage.errors,
          });
        } else {
          // Return zero stats for days without data
          stats.push({
            tenantId,
            period: {
              start: `${dateStr}T00:00:00.000Z`,
              end: `${dateStr}T23:59:59.999Z`,
            },
            requests: { total: 0, successful: 0, failed: 0, rateLimited: 0 },
            bandwidth: { inbound: 0, outbound: 0 },
            sessions: { total: 0, active: 0, peak: 0 },
            errors: { total: 0, byType: {} },
          });
        }
      }
      
      return stats.reverse(); // Return in chronological order
    } catch (error) {
      console.error(`Failed to get usage stats for tenant ${tenantId}:`, error);
      return [];
    }
  }
}

export const tenantService = new TenantService();