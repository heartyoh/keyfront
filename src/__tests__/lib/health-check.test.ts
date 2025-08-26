import { HealthChecker, HealthStatus, ServiceHealth, DetailedHealthReport, healthChecker } from '../../lib/health-check'
import * as redisService from '../../services/redis'
import * as keycloakService from '../../services/keycloak'
import * as websocketService from '../../services/websocket'

// Mock dependencies
jest.mock('../../services/redis')
jest.mock('../../services/keycloak')
jest.mock('../../services/websocket')

const mockRedisService = redisService as jest.Mocked<typeof redisService>
const mockKeycloakService = keycloakService as jest.Mocked<typeof keycloakService>
const mockWebsocketService = websocketService as jest.Mocked<typeof websocketService>

describe('HealthChecker', () => {
  let healthCheck: HealthChecker
  let originalProcessMemoryUsage: () => NodeJS.MemoryUsage

  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2024-01-01T00:00:00Z'))
    
    // Mock process.memoryUsage
    originalProcessMemoryUsage = process.memoryUsage
    process.memoryUsage = jest.fn().mockReturnValue({
      rss: 100 * 1024 * 1024,
      heapTotal: 80 * 1024 * 1024,
      heapUsed: 40 * 1024 * 1024,
      external: 10 * 1024 * 1024,
      arrayBuffers: 5 * 1024 * 1024,
    })
    
    // Reset environment variables
    process.env.npm_package_version = '1.0.0'
    process.env.BUILD_NUMBER = '123'
    process.env.GIT_COMMIT = 'abcdef1234567890'
    process.env.KC_ISSUER_URL = 'https://keycloak.test'
    process.env.KC_CLIENT_ID = 'test-client'
    
    healthCheck = new HealthChecker()
  })

  afterEach(() => {
    jest.useRealTimers()
    process.memoryUsage = originalProcessMemoryUsage
  })

  describe('Constructor', () => {
    it('should initialize with current timestamp', () => {
      expect(healthCheck['startTime']).toBe(Date.now())
    })

    it('should initialize with empty cache', () => {
      expect(healthCheck['cachedHealth']).toBeNull()
      expect(healthCheck['lastCacheTime']).toBe(0)
    })
  })

  describe('Basic Health Check', () => {
    beforeEach(() => {
      mockRedisService.redisService = {
        set: jest.fn().mockResolvedValue('OK'),
        get: jest.fn().mockResolvedValue('ok'),
      } as any
    })

    it('should return healthy status when all checks pass', async () => {
      // Simulate 1 hour uptime
      jest.advanceTimersByTime(3600000)
      
      const health = await healthCheck.getBasicHealth()
      
      expect(health.status).toBe('healthy')
      expect(health.timestamp).toBe('2024-01-01T01:00:00.000Z')
      expect(health.uptime).toBe(3600) // 1 hour in seconds
      expect(health.version).toBe('1.0.0')
      expect(health.build).toBe('123')
      expect(health.commit).toBe('abcdef1')
    })

    it('should return degraded status when memory usage is high', async () => {
      // Mock high memory usage (75%)
      process.memoryUsage = jest.fn().mockReturnValue({
        rss: 100 * 1024 * 1024,
        heapTotal: 80 * 1024 * 1024,
        heapUsed: 60 * 1024 * 1024, // 75%
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024,
      })
      
      const health = await healthCheck.getBasicHealth()
      
      expect(health.status).toBe('degraded')
    })

    it('should return unhealthy status when memory usage is critical', async () => {
      // Mock critical memory usage (95%)
      process.memoryUsage = jest.fn().mockReturnValue({
        rss: 100 * 1024 * 1024,
        heapTotal: 80 * 1024 * 1024,
        heapUsed: 76 * 1024 * 1024, // 95%
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024,
      })
      
      const health = await healthCheck.getBasicHealth()
      
      expect(health.status).toBe('unhealthy')
    })

    it('should return unhealthy status when Redis is down', async () => {
      mockRedisService.redisService.set = jest.fn().mockRejectedValue(new Error('Redis connection failed'))
      
      const health = await healthCheck.getBasicHealth()
      
      expect(health.status).toBe('unhealthy')
    })

    it('should handle errors gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
      
      // Mock process.memoryUsage to throw error
      process.memoryUsage = jest.fn().mockImplementation(() => {
        throw new Error('Memory check failed')
      })
      
      const health = await healthCheck.getBasicHealth()
      
      expect(health.status).toBe('unhealthy')
      expect(consoleSpy).toHaveBeenCalledWith('Basic health check error:', expect.any(Error))
      
      consoleSpy.mockRestore()
    })

    it('should use default version when environment variable is missing', async () => {
      delete process.env.npm_package_version
      
      const health = await healthCheck.getBasicHealth()
      
      expect(health.version).toBe('0.1.0')
    })
  })

  describe('Detailed Health Check', () => {
    beforeEach(() => {
      // Mock all services as healthy
      mockRedisService.redisService = {
        set: jest.fn().mockResolvedValue('OK'),
        get: jest.fn()
          .mockResolvedValueOnce('ping') // Redis health check
          .mockResolvedValueOnce('100') // Total requests
          .mockResolvedValueOnce('5') // Total errors
          .mockResolvedValueOnce('1500'), // Total response time
        delete: jest.fn().mockResolvedValue(1),
      } as any
      
      mockKeycloakService.keycloakService = {
        initialize: jest.fn().mockResolvedValue(undefined),
      } as any
      
      mockWebsocketService.websocketService = {
        getConnectionCount: jest.fn().mockReturnValue(10),
      } as any
    })

    it('should return detailed health report with all services healthy', async () => {
      jest.advanceTimersByTime(1800000) // 30 minutes
      
      const report = await healthCheck.getDetailedHealth()
      
      expect(report.overall.status).toBe('healthy')
      expect(report.overall.uptime).toBe(1800)
      expect(report.services).toHaveLength(2)
      expect(report.services[0].name).toBe('redis')
      expect(report.services[1].name).toBe('keycloak')
      expect(report.dependencies.redis.status).toBe('healthy')
      expect(report.dependencies.keycloak.status).toBe('healthy')
      expect(report.metrics.memoryUsage.percentage).toBe(50) // 40MB/80MB
      expect(report.metrics.totalRequests).toBe(100)
      expect(report.metrics.errorRate).toBe(0.05)
      expect(report.metrics.avgResponseTime).toBe(15)
      expect(report.metrics.activeConnections).toBe(10)
    })

    it('should cache health report and return cached result', async () => {
      const firstReport = await healthCheck.getDetailedHealth()
      const secondReport = await healthCheck.getDetailedHealth()
      
      expect(firstReport).toBe(secondReport) // Same object reference
      expect(mockRedisService.redisService.set).toHaveBeenCalledTimes(1) // Only called once
    })

    it('should refresh cache when forced', async () => {
      await healthCheck.getDetailedHealth() // Initial call
      const refreshedReport = await healthCheck.getDetailedHealth(true) // Force refresh
      
      expect(mockRedisService.redisService.set).toHaveBeenCalledTimes(2)
    })

    it('should refresh cache when expired', async () => {
      await healthCheck.getDetailedHealth() // Initial call
      
      // Advance time beyond cache timeout (30 seconds)
      jest.advanceTimersByTime(35000)
      
      await healthCheck.getDetailedHealth() // Should refresh automatically
      
      expect(mockRedisService.redisService.set).toHaveBeenCalledTimes(2)
    })

    it('should handle Redis service errors gracefully', async () => {
      mockRedisService.redisService.set = jest.fn().mockRejectedValue(new Error('Redis connection failed'))
      
      const report = await healthCheck.getDetailedHealth()
      
      expect(report.dependencies.redis.status).toBe('unhealthy')
      expect(report.dependencies.redis.error).toBe('Redis connection failed')
      expect(report.overall.status).toBe('unhealthy')
    })

    it('should handle Keycloak service errors gracefully', async () => {
      mockKeycloakService.keycloakService.initialize = jest.fn().mockRejectedValue(new Error('Keycloak unreachable'))
      
      const report = await healthCheck.getDetailedHealth()
      
      expect(report.dependencies.keycloak.status).toBe('unhealthy')
      expect(report.dependencies.keycloak.error).toBe('Keycloak unreachable')
      expect(report.overall.status).toBe('unhealthy')
    })

    it('should return degraded status when some services are degraded', async () => {
      // Simulate slow Redis (600ms response time)
      let callCount = 0
      mockRedisService.redisService.set = jest.fn().mockImplementation(() => {
        return new Promise(resolve => {
          setTimeout(() => resolve('OK'), callCount++ === 0 ? 600 : 0)
        })
      })
      
      const report = await healthCheck.getDetailedHealth()
      
      expect(report.dependencies.redis.status).toBe('degraded')
      expect(report.overall.status).toBe('degraded')
    })

    it('should handle complete health check failure', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
      
      // Mock all service checks to fail
      mockRedisService.redisService.set = jest.fn().mockRejectedValue(new Error('Redis failed'))
      mockKeycloakService.keycloakService.initialize = jest.fn().mockRejectedValue(new Error('Keycloak failed'))
      
      // Mock the basic health check to also fail
      jest.spyOn(healthCheck, 'getBasicHealth').mockRejectedValue(new Error('Basic health failed'))
      
      const report = await healthCheck.getDetailedHealth()
      
      expect(report.overall.status).toBe('unhealthy')
      expect(report.metrics.errorRate).toBe(1)
      expect(consoleSpy).toHaveBeenCalledWith('Detailed health check error:', expect.any(Error))
      
      consoleSpy.mockRestore()
    })
  })

  describe('Redis Health Check', () => {
    it('should return healthy when Redis responds quickly', async () => {
      mockRedisService.redisService = {
        set: jest.fn().mockResolvedValue('OK'),
        get: jest.fn().mockResolvedValue('ping'),
        delete: jest.fn().mockResolvedValue(1),
      } as any
      
      const health = await healthCheck['checkRedis']()
      
      expect(health.name).toBe('redis')
      expect(health.status).toBe('healthy')
      expect(health.responseTime).toBeLessThan(100)
      expect(health.details).toEqual({
        testResult: 'ping successful',
        connectionPool: 'active',
      })
    })

    it('should return degraded when Redis is slow', async () => {
      mockRedisService.redisService = {
        set: jest.fn().mockImplementation(() => new Promise(resolve => setTimeout(() => resolve('OK'), 600))),
        get: jest.fn().mockResolvedValue('ping'),
        delete: jest.fn().mockResolvedValue(1),
      } as any
      
      const health = await healthCheck['checkRedis']()
      
      expect(health.status).toBe('degraded')
      expect(health.responseTime).toBeGreaterThan(500)
    })

    it('should return unhealthy when Redis is very slow', async () => {
      mockRedisService.redisService = {
        set: jest.fn().mockImplementation(() => new Promise(resolve => setTimeout(() => resolve('OK'), 1100))),
        get: jest.fn().mockResolvedValue('ping'),
        delete: jest.fn().mockResolvedValue(1),
      } as any
      
      const health = await healthCheck['checkRedis']()
      
      expect(health.status).toBe('unhealthy')
      expect(health.responseTime).toBeGreaterThan(1000)
    })

    it('should return unhealthy when Redis test fails', async () => {
      mockRedisService.redisService = {
        set: jest.fn().mockResolvedValue('OK'),
        get: jest.fn().mockResolvedValue('wrong-response'),
        delete: jest.fn().mockResolvedValue(1),
      } as any
      
      const health = await healthCheck['checkRedis']()
      
      expect(health.status).toBe('unhealthy')
      expect(health.error).toBe('Redis test failed: incorrect response')
    })

    it('should return unhealthy when Redis connection fails', async () => {
      mockRedisService.redisService = {
        set: jest.fn().mockRejectedValue(new Error('Connection refused')),
        get: jest.fn(),
        delete: jest.fn(),
      } as any
      
      const health = await healthCheck['checkRedis']()
      
      expect(health.status).toBe('unhealthy')
      expect(health.error).toBe('Connection refused')
    })
  })

  describe('Keycloak Health Check', () => {
    it('should return healthy when Keycloak initializes quickly', async () => {
      mockKeycloakService.keycloakService = {
        initialize: jest.fn().mockResolvedValue(undefined),
      } as any
      
      const health = await healthCheck['checkKeycloak']()
      
      expect(health.name).toBe('keycloak')
      expect(health.status).toBe('healthy')
      expect(health.responseTime).toBeLessThan(100)
      expect(health.details).toEqual({
        issuerUrl: 'https://keycloak.test',
        clientId: 'test-client',
      })
    })

    it('should return degraded when Keycloak is slow', async () => {
      mockKeycloakService.keycloakService = {
        initialize: jest.fn().mockImplementation(() => new Promise(resolve => setTimeout(resolve, 1200))),
      } as any
      
      const health = await healthCheck['checkKeycloak']()
      
      expect(health.status).toBe('degraded')
      expect(health.responseTime).toBeGreaterThan(1000)
    })

    it('should return unhealthy when Keycloak is very slow', async () => {
      mockKeycloakService.keycloakService = {
        initialize: jest.fn().mockImplementation(() => new Promise(resolve => setTimeout(resolve, 2100))),
      } as any
      
      const health = await healthCheck['checkKeycloak']()
      
      expect(health.status).toBe('unhealthy')
      expect(health.responseTime).toBeGreaterThan(2000)
    })

    it('should return unhealthy when Keycloak initialization fails', async () => {
      mockKeycloakService.keycloakService = {
        initialize: jest.fn().mockRejectedValue(new Error('OIDC discovery failed')),
      } as any
      
      const health = await healthCheck['checkKeycloak']()
      
      expect(health.status).toBe('unhealthy')
      expect(health.error).toBe('OIDC discovery failed')
    })
  })

  describe('System Metrics', () => {
    it('should return memory usage metrics', async () => {
      const metrics = await healthCheck['getSystemMetrics']()
      
      expect(metrics.used).toBe(40 * 1024 * 1024)
      expect(metrics.total).toBe(80 * 1024 * 1024)
      expect(metrics.percentage).toBe(50)
    })
  })

  describe('Service Metrics', () => {
    beforeEach(() => {
      mockRedisService.redisService = {
        get: jest.fn()
          .mockResolvedValueOnce('1000') // Total requests
          .mockResolvedValueOnce('50') // Total errors
          .mockResolvedValueOnce('15000'), // Total response time
      } as any
      
      mockWebsocketService.websocketService = {
        getConnectionCount: jest.fn().mockReturnValue(25),
      } as any
    })

    it('should return service metrics from Redis', async () => {
      const metrics = await healthCheck['getServiceMetrics']()
      
      expect(metrics.totalRequests).toBe(1000)
      expect(metrics.errorRate).toBe(0.05) // 50/1000
      expect(metrics.avgResponseTime).toBe(15) // 15000/1000
      expect(metrics.activeConnections).toBe(25)
    })

    it('should handle missing Redis data gracefully', async () => {
      mockRedisService.redisService.get = jest.fn().mockResolvedValue(null)
      
      const metrics = await healthCheck['getServiceMetrics']()
      
      expect(metrics.totalRequests).toBe(0)
      expect(metrics.errorRate).toBe(0)
      expect(metrics.avgResponseTime).toBe(0)
    })

    it('should handle Redis errors gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
      mockRedisService.redisService.get = jest.fn().mockRejectedValue(new Error('Redis error'))
      
      const metrics = await healthCheck['getServiceMetrics']()
      
      expect(metrics.totalRequests).toBe(0)
      expect(metrics.errorRate).toBe(0)
      expect(metrics.avgResponseTime).toBe(0)
      expect(metrics.activeConnections).toBe(0)
      expect(consoleSpy).toHaveBeenCalledWith('Failed to get service metrics:', expect.any(Error))
      
      consoleSpy.mockRestore()
    })
  })

  describe('Readiness and Liveness Checks', () => {
    it('should return true when ready (healthy or degraded)', async () => {
      jest.spyOn(healthCheck, 'getBasicHealth').mockResolvedValue({
        status: 'healthy',
        timestamp: '2024-01-01T00:00:00.000Z',
        uptime: 1800,
        version: '1.0.0',
      })
      
      const isReady = await healthCheck.isReady()
      expect(isReady).toBe(true)
    })

    it('should return false when not ready (unhealthy)', async () => {
      jest.spyOn(healthCheck, 'getBasicHealth').mockResolvedValue({
        status: 'unhealthy',
        timestamp: '2024-01-01T00:00:00.000Z',
        uptime: 1800,
        version: '1.0.0',
      })
      
      const isReady = await healthCheck.isReady()
      expect(isReady).toBe(false)
    })

    it('should return false when readiness check fails', async () => {
      jest.spyOn(healthCheck, 'getBasicHealth').mockRejectedValue(new Error('Health check failed'))
      
      const isReady = await healthCheck.isReady()
      expect(isReady).toBe(false)
    })

    it('should return true for liveness check (process running)', async () => {
      const isAlive = await healthCheck.isAlive()
      expect(isAlive).toBe(true)
    })

    it('should handle liveness check errors', async () => {
      // Force an error in the liveness check (though this is unlikely)
      const originalIsAlive = healthCheck.isAlive
      healthCheck.isAlive = jest.fn().mockImplementation(() => {
        throw new Error('Unexpected error')
      })
      
      const isAlive = await healthCheck.isAlive()
      expect(isAlive).toBe(false)
      
      healthCheck.isAlive = originalIsAlive
    })
  })

  describe('Cache Management', () => {
    it('should clear cache', () => {
      healthCheck['cachedHealth'] = {} as DetailedHealthReport
      healthCheck['lastCacheTime'] = Date.now()
      
      healthCheck.clearCache()
      
      expect(healthCheck['cachedHealth']).toBeNull()
      expect(healthCheck['lastCacheTime']).toBe(0)
    })
  })
})

describe('Global health checker instance', () => {
  it('should export a global health checker instance', () => {
    expect(healthChecker).toBeInstanceOf(HealthChecker)
  })

  it('should have the same interface as HealthChecker', () => {
    expect(typeof healthChecker.getBasicHealth).toBe('function')
    expect(typeof healthChecker.getDetailedHealth).toBe('function')
    expect(typeof healthChecker.isReady).toBe('function')
    expect(typeof healthChecker.isAlive).toBe('function')
    expect(typeof healthChecker.clearCache).toBe('function')
  })
})