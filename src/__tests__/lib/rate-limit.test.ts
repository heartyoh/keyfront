import { RateLimiter, rateLimiters, createRateLimitMiddleware, CompositeRateLimiter } from '../../lib/rate-limit'
import { NextRequest } from 'next/server'
import { UserSession } from '../../types/auth'
import * as redisService from '../../services/redis'
import * as auditModule from '../../lib/audit'

// Mock dependencies
jest.mock('../../services/redis')
jest.mock('../../lib/audit')

const mockRedisService = redisService as jest.Mocked<typeof redisService>
const mockAuditEvents = auditModule.auditEvents as jest.Mocked<typeof auditModule.auditEvents>

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter
  let mockRequest: NextRequest
  let mockUser: UserSession

  beforeEach(() => {
    jest.clearAllMocks()
    
    rateLimiter = new RateLimiter({
      windowMs: 60000, // 1 minute
      maxRequests: 5,
    })

    mockRequest = new NextRequest('http://localhost:3000/api/test', {
      method: 'GET',
      headers: {
        'x-forwarded-for': '192.168.1.1',
      },
    })

    mockUser = {
      id: 'user123',
      sub: 'user123',
      tenantId: 'tenant1',
      email: 'test@example.com',
      name: 'Test User',
      roles: ['USER'],
      permissions: ['read'],
      accessTokenRef: 'access-ref',
      refreshTokenRef: 'refresh-ref',
      expiresAt: Date.now() + 3600000,
      createdAt: Date.now() - 86400000,
      lastActivity: Date.now(),
    }

    // Mock Redis pipeline
    const mockPipeline = {
      get: jest.fn().mockReturnThis(),
      incr: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn(),
    }

    mockRedisService.redisService = {
      pipeline: jest.fn(() => mockPipeline),
    } as any
  })

  describe('Basic functionality', () => {
    it('should create a rate limiter with correct config', () => {
      expect(rateLimiter.windowMs).toBe(60000)
      expect(rateLimiter.message).toBe('Too many requests, please try again later')
    })

    it('should allow request when under limit', async () => {
      const mockPipeline = mockRedisService.redisService.pipeline()
      mockPipeline.exec.mockResolvedValue([
        [null, null], // get result
        [null, 1],    // incr result
        [null, 1],    // expire result
      ])

      const result = await rateLimiter.check(mockRequest, mockUser)

      expect(result.allowed).toBe(true)
      expect(result.current).toBe(1)
      expect(result.remaining).toBe(4)
      expect(result.limit).toBe(5)
    })

    it('should deny request when over limit', async () => {
      const mockPipeline = mockRedisService.redisService.pipeline()
      mockPipeline.exec.mockResolvedValue([
        [null, null], // get result
        [null, 6],    // incr result (over limit)
        [null, 1],    // expire result
      ])

      const result = await rateLimiter.check(mockRequest, mockUser)

      expect(result.allowed).toBe(false)
      expect(result.current).toBe(6)
      expect(result.remaining).toBe(0)
      expect(result.retryAfter).toBeDefined()
    })

    it('should log rate limit hits for authenticated users', async () => {
      const mockPipeline = mockRedisService.redisService.pipeline()
      mockPipeline.exec.mockResolvedValue([
        [null, null],
        [null, 6], // over limit
        [null, 1],
      ])

      mockAuditEvents.rateLimitHit.mockResolvedValue()

      await rateLimiter.check(mockRequest, mockUser, 'trace-123')

      expect(mockAuditEvents.rateLimitHit).toHaveBeenCalledWith(
        'trace-123',
        'tenant1',
        'user123',
        expect.stringContaining('user:tenant1:user123'),
        expect.objectContaining({
          limit: 5,
          current: 6,
        })
      )
    })

    it('should fail open on Redis errors', async () => {
      const mockPipeline = mockRedisService.redisService.pipeline()
      mockPipeline.exec.mockRejectedValue(new Error('Redis connection failed'))

      const result = await rateLimiter.check(mockRequest, mockUser)

      expect(result.allowed).toBe(true)
      expect(result.current).toBe(0)
      expect(result.remaining).toBe(5)
    })
  })

  describe('Key generation', () => {
    it('should use user ID for authenticated requests', async () => {
      const mockPipeline = mockRedisService.redisService.pipeline()
      mockPipeline.exec.mockResolvedValue([[null, null], [null, 1], [null, 1]])

      await rateLimiter.check(mockRequest, mockUser)

      expect(mockPipeline.get).toHaveBeenCalledWith(
        expect.stringContaining('user:tenant1:user123')
      )
    })

    it('should use IP for unauthenticated requests', async () => {
      const mockPipeline = mockRedisService.redisService.pipeline()
      mockPipeline.exec.mockResolvedValue([[null, null], [null, 1], [null, 1]])

      await rateLimiter.check(mockRequest)

      expect(mockPipeline.get).toHaveBeenCalledWith(
        expect.stringContaining('ip:192.168.1.1')
      )
    })

    it('should handle missing IP gracefully', async () => {
      const requestWithoutIP = new NextRequest('http://localhost:3000/api/test')
      const mockPipeline = mockRedisService.redisService.pipeline()
      mockPipeline.exec.mockResolvedValue([[null, null], [null, 1], [null, 1]])

      await rateLimiter.check(requestWithoutIP)

      expect(mockPipeline.get).toHaveBeenCalledWith(
        expect.stringContaining('ip:unknown')
      )
    })
  })

  describe('Custom key generators', () => {
    it('should use custom key generator when provided', async () => {
      const customLimiter = new RateLimiter({
        windowMs: 60000,
        maxRequests: 10,
        keyGenerator: (req, user) => `custom:${user?.tenantId || 'anonymous'}`,
      })

      const mockPipeline = mockRedisService.redisService.pipeline()
      mockPipeline.exec.mockResolvedValue([[null, null], [null, 1], [null, 1]])

      await customLimiter.check(mockRequest, mockUser)

      expect(mockPipeline.get).toHaveBeenCalledWith(
        expect.stringContaining('custom:tenant1')
      )
    })
  })
})

describe('Predefined rate limiters', () => {
  it('should have all expected rate limiters', () => {
    expect(rateLimiters.global).toBeInstanceOf(RateLimiter)
    expect(rateLimiters.user).toBeInstanceOf(RateLimiter)
    expect(rateLimiters.tenant).toBeInstanceOf(RateLimiter)
    expect(rateLimiters.login).toBeInstanceOf(RateLimiter)
    expect(rateLimiters.api).toBeInstanceOf(RateLimiter)
  })

  it('should have appropriate limits for each limiter', () => {
    expect(rateLimiters.global.windowMs).toBe(15 * 60 * 1000) // 15 minutes
    expect(rateLimiters.user.windowMs).toBe(60 * 1000) // 1 minute
    expect(rateLimiters.tenant.windowMs).toBe(60 * 1000) // 1 minute
    expect(rateLimiters.login.windowMs).toBe(15 * 60 * 1000) // 15 minutes
    expect(rateLimiters.api.windowMs).toBe(60 * 1000) // 1 minute
  })
})

describe('createRateLimitMiddleware', () => {
  let middleware: any
  let mockRateLimiter: jest.Mocked<RateLimiter>

  beforeEach(() => {
    mockRateLimiter = {
      check: jest.fn(),
      windowMs: 60000,
      message: 'Rate limit exceeded',
    } as any

    middleware = createRateLimitMiddleware(mockRateLimiter)
  })

  it('should return null when rate limit is not exceeded', async () => {
    mockRateLimiter.check.mockResolvedValue({
      allowed: true,
      current: 1,
      limit: 5,
      remaining: 4,
      resetTime: Date.now() + 60000,
    })

    const mockRequest = new NextRequest('http://localhost:3000/api/test')
    const result = await middleware(mockRequest)

    expect(result).toBeNull()
  })

  it('should return error response when rate limit is exceeded', async () => {
    mockRateLimiter.check.mockResolvedValue({
      allowed: false,
      current: 6,
      limit: 5,
      remaining: 0,
      resetTime: Date.now() + 60000,
      retryAfter: 60,
    })

    const mockRequest = new NextRequest('http://localhost:3000/api/test')
    const result = await middleware(mockRequest)

    expect(result).not.toBeNull()
    const responseData = await result!.json()
    expect(responseData.success).toBe(false)
    expect(responseData.error.code).toBe('RATE_LIMIT_EXCEEDED')
  })

  it('should skip rate limiting when skip condition is met', async () => {
    const middlewareWithSkip = createRateLimitMiddleware(mockRateLimiter, {
      skip: (req, user) => user?.roles.includes('ADMIN') || false,
    })

    const adminUser = { ...mockUser, roles: ['ADMIN'] }
    const mockRequest = new NextRequest('http://localhost:3000/api/test')
    
    const result = await middlewareWithSkip(mockRequest, adminUser)

    expect(result).toBeNull()
    expect(mockRateLimiter.check).not.toHaveBeenCalled()
  })
})

describe('CompositeRateLimiter', () => {
  let compositeLimit: CompositeRateLimiter
  let limiter1: jest.Mocked<RateLimiter>
  let limiter2: jest.Mocked<RateLimiter>

  beforeEach(() => {
    limiter1 = {
      check: jest.fn(),
      windowMs: 60000,
      message: 'Limiter 1',
    } as any

    limiter2 = {
      check: jest.fn(),
      windowMs: 60000,
      message: 'Limiter 2',
    } as any

    compositeLimit = new CompositeRateLimiter([
      { limiter: limiter1, name: 'limiter1' },
      { limiter: limiter2, name: 'limiter2' },
    ])
  })

  it('should return first failing limit', async () => {
    limiter1.check.mockResolvedValue({
      allowed: true,
      current: 1,
      limit: 5,
      remaining: 4,
      resetTime: Date.now() + 60000,
    })

    limiter2.check.mockResolvedValue({
      allowed: false,
      current: 6,
      limit: 5,
      remaining: 0,
      resetTime: Date.now() + 60000,
    })

    const mockRequest = new NextRequest('http://localhost:3000/api/test')
    const result = await compositeLimit.checkAll(mockRequest)

    expect(result.allowed).toBe(false)
    expect(result.current).toBe(6)
  })

  it('should return most restrictive limit when all pass', async () => {
    limiter1.check.mockResolvedValue({
      allowed: true,
      current: 2,
      limit: 5,
      remaining: 3,
      resetTime: Date.now() + 60000,
    })

    limiter2.check.mockResolvedValue({
      allowed: true,
      current: 4,
      limit: 10,
      remaining: 6,
      resetTime: Date.now() + 60000,
    })

    const mockRequest = new NextRequest('http://localhost:3000/api/test')
    const result = await compositeLimit.checkAll(mockRequest)

    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(3) // Most restrictive
  })
})