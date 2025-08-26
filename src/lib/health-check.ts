import { redisService } from '@/services/redis';
import { keycloakService } from '@/services/keycloak';
import { websocketService } from '@/services/websocket';

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  build?: string;
  commit?: string;
}

export interface ServiceHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  responseTime: number;
  lastCheck: string;
  error?: string;
  details?: Record<string, any>;
}

export interface DetailedHealthReport {
  overall: HealthStatus;
  services: ServiceHealth[];
  metrics: {
    totalRequests: number;
    errorRate: number;
    avgResponseTime: number;
    activeConnections: number;
    memoryUsage: {
      used: number;
      total: number;
      percentage: number;
    };
    cpuUsage?: number;
  };
  dependencies: {
    redis: ServiceHealth;
    keycloak: ServiceHealth;
    downstream?: ServiceHealth;
  };
}

export class HealthChecker {
  private startTime: number;
  private cachedHealth: DetailedHealthReport | null = null;
  private lastCacheTime: number = 0;
  private cacheTimeout: number = 30000; // 30 seconds

  constructor() {
    this.startTime = Date.now();
  }

  /**
   * Get basic health status
   */
  async getBasicHealth(): Promise<HealthStatus> {
    try {
      const uptime = Date.now() - this.startTime;
      
      // Quick checks
      const redisHealthy = await this.checkRedisBasic();
      const memUsage = process.memoryUsage();
      const memPercentage = (memUsage.heapUsed / memUsage.heapTotal) * 100;

      let status: HealthStatus['status'] = 'healthy';
      
      if (!redisHealthy || memPercentage > 90) {
        status = 'unhealthy';
      } else if (memPercentage > 70) {
        status = 'degraded';
      }

      return {
        status,
        timestamp: new Date().toISOString(),
        uptime: Math.floor(uptime / 1000), // seconds
        version: process.env.npm_package_version || '0.1.0',
        build: process.env.BUILD_NUMBER,
        commit: process.env.GIT_COMMIT?.substring(0, 7),
      };
    } catch (error) {
      console.error('Basic health check error:', error);
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        uptime: Math.floor((Date.now() - this.startTime) / 1000),
        version: process.env.npm_package_version || '0.1.0',
      };
    }
  }

  /**
   * Get detailed health report
   */
  async getDetailedHealth(forceRefresh: boolean = false): Promise<DetailedHealthReport> {
    const now = Date.now();
    
    // Return cached result if available and not expired
    if (!forceRefresh && this.cachedHealth && (now - this.lastCacheTime) < this.cacheTimeout) {
      return this.cachedHealth;
    }

    try {
      const [
        basicHealth,
        redisHealth,
        keycloakHealth,
        systemMetrics,
        serviceMetrics
      ] = await Promise.allSettled([
        this.getBasicHealth(),
        this.checkRedis(),
        this.checkKeycloak(),
        this.getSystemMetrics(),
        this.getServiceMetrics(),
      ]);

      const basic = basicHealth.status === 'fulfilled' ? basicHealth.value : {
        status: 'unhealthy' as const,
        timestamp: new Date().toISOString(),
        uptime: Math.floor((Date.now() - this.startTime) / 1000),
        version: '0.1.0',
      };

      const redis = redisHealth.status === 'fulfilled' ? redisHealth.value : {
        name: 'redis',
        status: 'unhealthy' as const,
        responseTime: -1,
        lastCheck: new Date().toISOString(),
        error: redisHealth.status === 'rejected' ? redisHealth.reason?.message : 'Unknown error',
      };

      const keycloak = keycloakHealth.status === 'fulfilled' ? keycloakHealth.value : {
        name: 'keycloak',
        status: 'unhealthy' as const,
        responseTime: -1,
        lastCheck: new Date().toISOString(),
        error: keycloakHealth.status === 'rejected' ? keycloakHealth.reason?.message : 'Unknown error',
      };

      const metrics = systemMetrics.status === 'fulfilled' ? systemMetrics.value : {
        used: 0,
        total: 0,
        percentage: 0,
      };

      const svcMetrics = serviceMetrics.status === 'fulfilled' ? serviceMetrics.value : {
        totalRequests: 0,
        errorRate: 0,
        avgResponseTime: 0,
        activeConnections: 0,
      };

      // Determine overall status
      const services = [redis, keycloak];
      const unhealthyServices = services.filter(s => s.status === 'unhealthy').length;
      const degradedServices = services.filter(s => s.status === 'degraded').length;

      let overallStatus: HealthStatus['status'] = 'healthy';
      if (unhealthyServices > 0) {
        overallStatus = 'unhealthy';
      } else if (degradedServices > 0 || basic.status === 'degraded') {
        overallStatus = 'degraded';
      }

      const report: DetailedHealthReport = {
        overall: {
          ...basic,
          status: overallStatus,
        },
        services,
        metrics: {
          ...svcMetrics,
          memoryUsage: metrics,
        },
        dependencies: {
          redis,
          keycloak,
        },
      };

      // Cache the result
      this.cachedHealth = report;
      this.lastCacheTime = now;

      return report;
    } catch (error) {
      console.error('Detailed health check error:', error);
      
      const failureReport: DetailedHealthReport = {
        overall: {
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          uptime: Math.floor((Date.now() - this.startTime) / 1000),
          version: process.env.npm_package_version || '0.1.0',
        },
        services: [],
        metrics: {
          totalRequests: 0,
          errorRate: 1,
          avgResponseTime: 0,
          activeConnections: 0,
          memoryUsage: {
            used: 0,
            total: 0,
            percentage: 100,
          },
        },
        dependencies: {
          redis: {
            name: 'redis',
            status: 'unhealthy',
            responseTime: -1,
            lastCheck: new Date().toISOString(),
            error: 'Health check failed',
          },
          keycloak: {
            name: 'keycloak',
            status: 'unhealthy',
            responseTime: -1,
            lastCheck: new Date().toISOString(),
            error: 'Health check failed',
          },
        },
      };

      return failureReport;
    }
  }

  private async checkRedisBasic(): Promise<boolean> {
    try {
      await redisService.set('health:check', 'ok', 10);
      await redisService.get('health:check');
      return true;
    } catch {
      return false;
    }
  }

  private async checkRedis(): Promise<ServiceHealth> {
    const startTime = Date.now();
    
    try {
      // Test Redis connectivity and performance
      const testKey = `health:check:${Date.now()}`;
      await redisService.set(testKey, 'ping', 10);
      const result = await redisService.get(testKey);
      await redisService.delete(testKey);
      
      const responseTime = Date.now() - startTime;
      
      if (result !== 'ping') {
        throw new Error('Redis test failed: incorrect response');
      }

      let status: ServiceHealth['status'] = 'healthy';
      if (responseTime > 1000) {
        status = 'unhealthy';
      } else if (responseTime > 500) {
        status = 'degraded';
      }

      return {
        name: 'redis',
        status,
        responseTime,
        lastCheck: new Date().toISOString(),
        details: {
          testResult: 'ping successful',
          connectionPool: 'active',
        },
      };
    } catch (error) {
      return {
        name: 'redis',
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        lastCheck: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown Redis error',
      };
    }
  }

  private async checkKeycloak(): Promise<ServiceHealth> {
    const startTime = Date.now();
    
    try {
      // Initialize Keycloak client if not already done
      await keycloakService.initialize();
      
      const responseTime = Date.now() - startTime;
      
      let status: ServiceHealth['status'] = 'healthy';
      if (responseTime > 2000) {
        status = 'unhealthy';
      } else if (responseTime > 1000) {
        status = 'degraded';
      }

      return {
        name: 'keycloak',
        status,
        responseTime,
        lastCheck: new Date().toISOString(),
        details: {
          issuerUrl: process.env.KC_ISSUER_URL,
          clientId: process.env.KC_CLIENT_ID,
        },
      };
    } catch (error) {
      return {
        name: 'keycloak',
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        lastCheck: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown Keycloak error',
      };
    }
  }

  private async getSystemMetrics(): Promise<{
    used: number;
    total: number;
    percentage: number;
  }> {
    const memUsage = process.memoryUsage();
    
    return {
      used: memUsage.heapUsed,
      total: memUsage.heapTotal,
      percentage: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100),
    };
  }

  private async getServiceMetrics(): Promise<{
    totalRequests: number;
    errorRate: number;
    avgResponseTime: number;
    activeConnections: number;
  }> {
    try {
      // Get metrics from Redis if available
      const totalRequests = parseInt(await redisService.get('metrics:requests:total') || '0');
      const totalErrors = parseInt(await redisService.get('metrics:errors:total') || '0');
      const totalResponseTime = parseInt(await redisService.get('metrics:response_time:total') || '0');
      
      // Get WebSocket connections
      const activeConnections = websocketService.getConnectionCount();

      return {
        totalRequests,
        errorRate: totalRequests > 0 ? totalErrors / totalRequests : 0,
        avgResponseTime: totalRequests > 0 ? totalResponseTime / totalRequests : 0,
        activeConnections,
      };
    } catch (error) {
      console.error('Failed to get service metrics:', error);
      return {
        totalRequests: 0,
        errorRate: 0,
        avgResponseTime: 0,
        activeConnections: 0,
      };
    }
  }

  /**
   * Check if service is ready to accept traffic
   */
  async isReady(): Promise<boolean> {
    try {
      const health = await this.getBasicHealth();
      return health.status !== 'unhealthy';
    } catch {
      return false;
    }
  }

  /**
   * Check if service is alive (basic liveness)
   */
  async isAlive(): Promise<boolean> {
    try {
      // Very basic check - just return true if process is running
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clear health cache
   */
  clearCache(): void {
    this.cachedHealth = null;
    this.lastCacheTime = 0;
  }
}

// Global health checker instance
export const healthChecker = new HealthChecker();