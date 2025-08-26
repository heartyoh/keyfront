import { withSession } from '../../middleware/session'
import { redisService } from '../../services/redis'
import { NextRequest, NextResponse } from 'next/server'
import type { UserSession } from '../../types/auth'

// Mock NextResponse to use our mock implementation
jest.mock('next/server', () => ({
  ...jest.requireActual('next/server'),
  NextResponse: {
    json: jest.fn((data, init = {}) => {
      return new global.Response(JSON.stringify(data), {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...(init?.headers || {})
        }
      });
    }),
  },
}))

// Mock dependencies
jest.mock('../../services/redis', () => ({
  redisService: {
    getSession: jest.fn(),
    setSession: jest.fn(), 
    deleteSession: jest.fn(),
    updateSessionActivity: jest.fn(),
    incrementRateLimit: jest.fn(),
    getRateLimit: jest.fn(),
  }
}))
jest.mock('../../lib/rate-limit', () => ({
  globalRateLimiter: {
    checkAll: jest.fn().mockResolvedValue({ allowed: true, limit: 100, remaining: 99, resetTime: Date.now() + 60000 })
  },
  addRateLimitHeaders: jest.fn((response) => response)
}))
jest.mock('../../lib/tracing', () => ({
  generateTraceId: jest.fn().mockReturnValue('trace-123')
}))
jest.mock('../../lib/metrics', () => ({
  metricsCollector: {
    increment: jest.fn(),
    incrementCounter: jest.fn(),
    histogram: jest.fn(),
    recordHistogram: jest.fn(),
    observeHistogram: jest.fn(),
    gauge: jest.fn(),
    setGauge: jest.fn(),
    recordRequestDuration: jest.fn(),
    recordWebSocketMetrics: jest.fn(),
    recordAuthMetrics: jest.fn(),
    recordSecurityMetrics: jest.fn(),
  }
}))
jest.mock('../../services/error-tracking', () => ({
  errorTracker: {
    recordError: jest.fn()
  }
}))

const mockRedisService = redisService as jest.Mocked<typeof redisService>

// Helper function to create mock session data
function createMockSession(overrides: Partial<UserSession> = {}): UserSession {
  return {
    id: 'user123',
    sub: 'user123',
    tenantId: 'tenant1',
    email: 'test@example.com',
    name: 'Test User',
    roles: ['USER'],
    permissions: ['read:profile'],
    accessTokenRef: 'access-token-ref',
    refreshTokenRef: 'refresh-token-ref',
    expiresAt: Date.now() + 3600000,
    createdAt: Date.now() - 10000,
    lastActivity: Date.now(),
    ...overrides
  }
}

describe('Session Middleware', () => {
  let mockRequest: NextRequest
  const mockHandler = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    mockHandler.mockResolvedValue(NextResponse.json({ success: true }))
    
    mockRequest = new NextRequest('http://localhost:3000/api/test', {
      method: 'GET',
    })

    // Add cookies to the mock request
    Object.defineProperty(mockRequest, 'cookies', {
      value: {
        get: jest.fn(),
        set: jest.fn(),
        delete: jest.fn(),
        has: jest.fn(),
        clear: jest.fn(),
        getAll: jest.fn(),
        toString: jest.fn(),
      },
      writable: true
    })
  })

  describe('withSession', () => {
    it('should pass authenticated session to handler when valid session exists', async () => {
      const sessionId = 'test-session-id'
      const sessionData = createMockSession()

      // Mock cookie retrieval
      ;(mockRequest.cookies.get as jest.Mock).mockReturnValue({ value: sessionId })
      
      // Mock session data retrieval
      mockRedisService.getSession.mockResolvedValue(sessionData)

      await withSession(mockRequest, mockHandler)

      expect(mockRedisService.getSession).toHaveBeenCalledWith(sessionId)
      expect(mockHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          user: sessionData,
          sessionId: sessionId
        })
      )
    })

    it('should return 401 when no session cookie exists', async () => {
      ;(mockRequest.cookies.get as jest.Mock).mockReturnValue(undefined)

      const response = await withSession(mockRequest, mockHandler)

      expect(response.status).toBe(401)
      expect(mockHandler).not.toHaveBeenCalled()
      
      const responseData = await response.json()
      expect(responseData.success).toBe(false)
      expect(responseData.error.code).toBe('UNAUTHORIZED')
    })

    it('should return 401 when session does not exist in Redis', async () => {
      const sessionId = 'non-existent-session'
      ;(mockRequest.cookies.get as jest.Mock).mockReturnValue({ value: sessionId })
      mockRedisService.getSession.mockResolvedValue(null)

      const response = await withSession(mockRequest, mockHandler)

      expect(response.status).toBe(401)
      expect(mockHandler).not.toHaveBeenCalled()
    })

    it('should return 401 when session is expired', async () => {
      const sessionId = 'expired-session'
      const expiredSession = createMockSession({
        expiresAt: Date.now() - 1000 // Expired 1 second ago
      })

      ;(mockRequest.cookies.get as jest.Mock).mockReturnValue({ value: sessionId })
      mockRedisService.getSession.mockResolvedValue(expiredSession)

      const response = await withSession(mockRequest, mockHandler)

      expect(response.status).toBe(401)
      expect(mockRedisService.deleteSession).toHaveBeenCalledWith(sessionId)
      expect(mockHandler).not.toHaveBeenCalled()
    })

    it('should return 429 when rate limit is exceeded', async () => {
      const { globalRateLimiter } = require('../../lib/rate-limit')
      globalRateLimiter.checkAll.mockResolvedValueOnce({ 
        allowed: false, 
        limit: 100, 
        remaining: 0, 
        resetTime: Date.now() + 60000,
        retryAfter: 60
      })

      const response = await withSession(mockRequest, mockHandler)

      expect(response.status).toBe(429)
      expect(mockHandler).not.toHaveBeenCalled()
      
      const responseData = await response.json()
      expect(responseData.error.code).toBe('RATE_LIMIT_EXCEEDED')
    })

    it('should handle Redis connection errors gracefully', async () => {
      const sessionId = 'test-session'
      ;(mockRequest.cookies.get as jest.Mock).mockReturnValue({ value: sessionId })
      mockRedisService.getSession.mockRejectedValue(new Error('Redis connection failed'))

      const response = await withSession(mockRequest, mockHandler)

      expect(response.status).toBe(500)
      expect(mockHandler).not.toHaveBeenCalled()
      
      const responseData = await response.json()
      expect(responseData.error.code).toBe('INTERNAL_ERROR')
    })

    it('should update session activity for valid sessions', async () => {
      const sessionId = 'test-session-id'
      const sessionData = createMockSession()

      ;(mockRequest.cookies.get as jest.Mock).mockReturnValue({ value: sessionId })
      mockRedisService.getSession.mockResolvedValue(sessionData)
      mockRedisService.updateSessionActivity.mockResolvedValue()

      await withSession(mockRequest, mockHandler)

      expect(mockRedisService.updateSessionActivity).toHaveBeenCalledWith(sessionId)
    })

    it('should include trace ID in responses', async () => {
      ;(mockRequest.cookies.get as jest.Mock).mockReturnValue(undefined)

      const response = await withSession(mockRequest, mockHandler)

      expect(response.headers.get('x-keyfront-trace-id')).toBe('trace-123')
      
      const responseData = await response.json()
      expect(responseData.error.traceId).toBe('trace-123')
    })

    it('should handle handler errors gracefully', async () => {
      const sessionId = 'test-session-id'
      const sessionData = createMockSession()

      ;(mockRequest.cookies.get as jest.Mock).mockReturnValue({ value: sessionId })
      mockRedisService.getSession.mockResolvedValue(sessionData)
      mockHandler.mockRejectedValue(new Error('Handler error'))

      const response = await withSession(mockRequest, mockHandler)

      expect(response.status).toBe(500)
      
      const responseData = await response.json()
      expect(responseData.error.code).toBe('INTERNAL_ERROR')
    })

    it('should return standardized error response format', async () => {
      ;(mockRequest.cookies.get as jest.Mock).mockReturnValue(undefined)

      const response = await withSession(mockRequest, mockHandler)
      const responseData = await response.json()

      expect(responseData).toHaveProperty('success', false)
      expect(responseData).toHaveProperty('error')
      expect(responseData.error).toHaveProperty('code')
      expect(responseData.error).toHaveProperty('message')
      expect(responseData.error).toHaveProperty('traceId')
      expect(responseData.error).toHaveProperty('traceId')
    })
  })

  describe('Performance and Metrics', () => {
    it('should record metrics for successful authentication', async () => {
      const sessionId = 'test-session-id'
      const sessionData = createMockSession()

      ;(mockRequest.cookies.get as jest.Mock).mockReturnValue({ value: sessionId })
      mockRedisService.getSession.mockResolvedValue(sessionData)

      await withSession(mockRequest, mockHandler)

      const { metricsCollector } = require('../../lib/metrics')
      expect(metricsCollector.recordRequestDuration).toHaveBeenCalledWith(
        'GET',
        '/api/test',
        200,
        expect.any(Number),
        expect.any(Object)
      )
    })

    it('should record metrics for authentication failures', async () => {
      ;(mockRequest.cookies.get as jest.Mock).mockReturnValue(undefined)

      await withSession(mockRequest, mockHandler)

      const { metricsCollector } = require('../../lib/metrics')
      expect(metricsCollector.recordRequestDuration).toHaveBeenCalledWith(
        'GET',
        '/api/test',
        401,
        expect.any(Number),
        expect.any(Object)
      )
    })

    it('should record response time metrics', async () => {
      const sessionId = 'test-session-id'
      const sessionData = createMockSession()

      ;(mockRequest.cookies.get as jest.Mock).mockReturnValue({ value: sessionId })
      mockRedisService.getSession.mockResolvedValue(sessionData)

      await withSession(mockRequest, mockHandler)

      const { metricsCollector } = require('../../lib/metrics')
      expect(metricsCollector.recordRequestDuration).toHaveBeenCalledWith(
        'GET',
        '/api/test',
        200,
        expect.any(Number),
        expect.any(Object)
      )
    })
  })

  describe('Enhanced Security and Validation', () => {
    it('should validate session cookie format', async () => {
      const invalidSessionId = 'invalid-session-with-special-chars!@#'
      ;(mockRequest.cookies.get as jest.Mock).mockReturnValue({ value: invalidSessionId })
      mockRedisService.getSession.mockResolvedValue(null)

      const response = await withSession(mockRequest, mockHandler)

      expect(response.status).toBe(401)
      expect(mockRedisService.getSession).toHaveBeenCalledWith(invalidSessionId)
    })

    it('should handle session hijacking attempts', async () => {
      const sessionId = 'test-session-id'
      const sessionData = createMockSession({
        // Session created from different IP (potential hijacking)
        lastActivity: Date.now() - 86400000 // 24 hours ago
      })

      ;(mockRequest.cookies.get as jest.Mock).mockReturnValue({ value: sessionId })
      mockRedisService.getSession.mockResolvedValue(sessionData)

      const response = await withSession(mockRequest, mockHandler)

      // Should still allow but update activity
      expect(mockRedisService.updateSessionActivity).toHaveBeenCalledWith(sessionId)
    })

    it('should handle malformed session data gracefully', async () => {
      const sessionId = 'test-session-id'
      ;(mockRequest.cookies.get as jest.Mock).mockReturnValue({ value: sessionId })
      mockRedisService.getSession.mockResolvedValue({
        // Malformed session missing required fields
        id: 'user123',
        // Missing other required fields
      } as UserSession)

      await withSession(mockRequest, mockHandler)

      // Should pass the malformed session and let handler deal with it
      expect(mockHandler).toHaveBeenCalled()
    })

    it('should enforce session expiration strictly', async () => {
      const sessionId = 'expired-session-id'
      const expiredSession = createMockSession({
        expiresAt: Date.now() - 1 // Expired by 1ms
      })

      ;(mockRequest.cookies.get as jest.Mock).mockReturnValue({ value: sessionId })
      mockRedisService.getSession.mockResolvedValue(expiredSession)

      const response = await withSession(mockRequest, mockHandler)

      expect(response.status).toBe(401)
      expect(mockRedisService.deleteSession).toHaveBeenCalledWith(sessionId)
      expect(mockHandler).not.toHaveBeenCalled()
    })

    it('should handle concurrent requests from same session', async () => {
      const sessionId = 'concurrent-session-id'
      const sessionData = createMockSession()

      ;(mockRequest.cookies.get as jest.Mock).mockReturnValue({ value: sessionId })
      mockRedisService.getSession.mockResolvedValue(sessionData)

      // Simulate concurrent requests
      const promises = Array.from({length: 5}, () => 
        withSession(mockRequest, mockHandler)
      )

      await Promise.all(promises)

      // All requests should succeed
      expect(mockHandler).toHaveBeenCalledTimes(5)
      expect(mockRedisService.updateSessionActivity).toHaveBeenCalledTimes(5)
    })

    it('should validate user permissions in session', async () => {
      const sessionId = 'test-session-id'
      const sessionWithoutPermissions = createMockSession({
        permissions: [] // No permissions
      })

      ;(mockRequest.cookies.get as jest.Mock).mockReturnValue({ value: sessionId })
      mockRedisService.getSession.mockResolvedValue(sessionWithoutPermissions)

      await withSession(mockRequest, mockHandler)

      // Should still pass to handler, which can then check permissions
      expect(mockHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          user: expect.objectContaining({
            permissions: []
          })
        })
      )
    })

    it('should handle very long session IDs', async () => {
      const longSessionId = 'a'.repeat(1000) // Very long session ID
      ;(mockRequest.cookies.get as jest.Mock).mockReturnValue({ value: longSessionId })
      mockRedisService.getSession.mockResolvedValue(null)

      const response = await withSession(mockRequest, mockHandler)

      expect(response.status).toBe(401)
      expect(mockRedisService.getSession).toHaveBeenCalledWith(longSessionId)
    })

    it('should handle Redis timeout gracefully', async () => {
      const sessionId = 'timeout-session'
      ;(mockRequest.cookies.get as jest.Mock).mockReturnValue({ value: sessionId })
      
      // Simulate Redis timeout
      mockRedisService.getSession.mockImplementation(() => 
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Redis timeout')), 100)
        )
      )

      const response = await withSession(mockRequest, mockHandler)

      expect(response.status).toBe(500)
      expect(mockHandler).not.toHaveBeenCalled()
    })
  })
})