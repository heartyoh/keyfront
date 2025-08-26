import { CsrfProtection, CsrfConfig, CsrfTokenInfo, withCsrfProtection, globalCsrf } from '../../lib/csrf'
import { NextRequest, NextResponse } from 'next/server'
import { UserSession } from '../../types/auth'
import * as redisService from '../../services/redis'
import * as tracingModule from '../../lib/tracing'
import crypto from 'crypto'

// Mock dependencies
jest.mock('../../services/redis')
jest.mock('../../lib/tracing')
jest.mock('crypto')

const mockRedisService = redisService as jest.Mocked<typeof redisService>
const mockTracing = tracingModule as jest.Mocked<typeof tracingModule>
const mockCrypto = crypto as jest.Mocked<typeof crypto>

// Mock NextResponse
jest.mock('next/server', () => ({
  ...jest.requireActual('next/server'),
  NextResponse: {
    json: jest.fn((data, init = {}) => {
      const response = new global.Response(JSON.stringify(data), {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...(init?.headers || {})
        }
      })
      response.headers.set = jest.fn()
      return response
    }),
  },
}))

describe('CsrfProtection', () => {
  let csrfProtection: CsrfProtection
  let mockUser: UserSession

  beforeEach(() => {
    jest.clearAllMocks()
    
    // Reset environment variables
    process.env.NODE_ENV = 'test'
    delete process.env.CSRF_SECRET
    delete process.env.SESSION_SECRET
    
    // Mock crypto functions
    mockCrypto.randomBytes = jest.fn().mockReturnValue(Buffer.from('random-token-data-here-32-bytes', 'utf8'))
    mockCrypto.createHmac = jest.fn().mockReturnValue({
      update: jest.fn().mockReturnThis(),
      digest: jest.fn().mockReturnValue('mocked-hash'),
    } as any)
    mockCrypto.timingSafeEqual = jest.fn().mockReturnValue(true)
    
    mockTracing.generateTraceId.mockReturnValue('trace-123')
    
    csrfProtection = new CsrfProtection()
    
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
  })

  describe('Constructor and Configuration', () => {
    it('should create with default configuration', () => {
      const csrf = new CsrfProtection()
      expect(csrf['config']).toBeDefined()
      expect(csrf['config'].tokenLength).toBe(32)
      expect(csrf['config'].cookieName).toBe('keyfront.csrf')
      expect(csrf['config'].headerName).toBe('x-csrf-token')
      expect(csrf['config'].excludeMethods).toEqual(['GET', 'HEAD', 'OPTIONS'])
    })

    it('should use environment variables for secrets', () => {
      process.env.CSRF_SECRET = 'custom-csrf-secret-32-characters-long'
      const csrf = new CsrfProtection()
      expect(csrf['config'].secret).toBe('custom-csrf-secret-32-characters-long')
    })

    it('should fall back to SESSION_SECRET', () => {
      process.env.SESSION_SECRET = 'session-secret-32-characters-long'
      const csrf = new CsrfProtection()
      expect(csrf['config'].secret).toBe('session-secret-32-characters-long')
    })

    it('should merge custom configuration', () => {
      const config: Partial<CsrfConfig> = {
        tokenLength: 64,
        cookieName: 'custom.csrf',
        maxAge: 7200,
        excludeMethods: ['GET', 'HEAD']
      }
      const csrf = new CsrfProtection(config)
      expect(csrf['config'].tokenLength).toBe(64)
      expect(csrf['config'].cookieName).toBe('custom.csrf')
      expect(csrf['config'].maxAge).toBe(7200)
      expect(csrf['config'].excludeMethods).toEqual(['GET', 'HEAD'])
    })

    it('should warn about short secrets', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()
      new CsrfProtection({ secret: 'short' })
      expect(consoleSpy).toHaveBeenCalledWith('CSRF secret should be at least 32 characters long')
      consoleSpy.mockRestore()
    })

    it('should set secure cookie in production', () => {
      process.env.NODE_ENV = 'production'
      const csrf = new CsrfProtection()
      expect(csrf['config'].secure).toBe(true)
    })
  })

  describe('Token generation', () => {
    it('should generate cryptographically secure tokens', () => {
      const token = csrfProtection['generateToken']()
      expect(mockCrypto.randomBytes).toHaveBeenCalledWith(32)
      expect(token).toBe('72616e646f6d2d746f6b656e2d646174612d686572652d33322d6279746573')
    })

    it('should create HMAC hash for tokens', () => {
      const token = 'test-token'
      const sessionId = 'session-123'
      
      const hash = csrfProtection['createTokenHash'](token, sessionId)
      
      expect(mockCrypto.createHmac).toHaveBeenCalledWith('sha256', expect.any(String))
      expect(hash).toBe('mocked-hash')
    })

    it('should verify token hashes with timing-safe comparison', () => {
      const token = 'test-token'
      const hash = 'test-hash'
      const sessionId = 'session-123'
      
      const isValid = csrfProtection['verifyTokenHash'](token, hash, sessionId)
      
      expect(mockCrypto.timingSafeEqual).toHaveBeenCalled()
      expect(isValid).toBe(true)
    })
  })

  describe('CSRF token lifecycle', () => {
    beforeEach(() => {
      mockRedisService.redisService = {
        set: jest.fn().mockResolvedValue('OK'),
        get: jest.fn(),
        delete: jest.fn().mockResolvedValue(1),
        getKeysByPattern: jest.fn().mockResolvedValue([]),
        deleteMultiple: jest.fn().mockResolvedValue(1),
      } as any
    })

    it('should generate new CSRF token', async () => {
      const sessionId = 'session-123'
      
      const tokenInfo = await csrfProtection.generateCsrfToken(sessionId, mockUser, 'trace-456')
      
      expect(tokenInfo.sessionId).toBe(sessionId)
      expect(tokenInfo.userId).toBe(mockUser.sub)
      expect(tokenInfo.tenantId).toBe(mockUser.tenantId)
      expect(tokenInfo.token).toBeDefined()
      expect(tokenInfo.hash).toBe('mocked-hash')
      expect(tokenInfo.expiresAt).toBeGreaterThan(Date.now())
      
      expect(mockRedisService.redisService.set).toHaveBeenCalledWith(
        `csrf:${sessionId}:${tokenInfo.token}`,
        JSON.stringify(tokenInfo),
        3600
      )
    })

    it('should validate valid CSRF token', async () => {
      const token = 'valid-token'
      const sessionId = 'session-123'
      const tokenInfo: CsrfTokenInfo = {
        token,
        hash: 'mocked-hash',
        expiresAt: Date.now() + 3600000,
        sessionId,
        userId: 'user123',
        tenantId: 'tenant1',
      }
      
      mockRedisService.redisService.get = jest.fn().mockResolvedValue(JSON.stringify(tokenInfo))
      
      const result = await csrfProtection.validateCsrfToken(token, sessionId)
      
      expect(result.valid).toBe(true)
      expect(result.tokenInfo).toEqual(tokenInfo)
      expect(mockRedisService.redisService.get).toHaveBeenCalledWith(`csrf:${sessionId}:${token}`)
    })

    it('should reject missing token', async () => {
      const result = await csrfProtection.validateCsrfToken('', 'session-123')
      
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('Missing token or session')
    })

    it('should reject token not found in Redis', async () => {
      mockRedisService.redisService.get = jest.fn().mockResolvedValue(null)
      
      const result = await csrfProtection.validateCsrfToken('nonexistent-token', 'session-123')
      
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('Token not found or expired')
    })

    it('should reject expired token', async () => {
      const token = 'expired-token'
      const sessionId = 'session-123'
      const expiredTokenInfo: CsrfTokenInfo = {
        token,
        hash: 'mocked-hash',
        expiresAt: Date.now() - 1000, // Expired
        sessionId,
        userId: 'user123',
        tenantId: 'tenant1',
      }
      
      mockRedisService.redisService.get = jest.fn().mockResolvedValue(JSON.stringify(expiredTokenInfo))
      
      const result = await csrfProtection.validateCsrfToken(token, sessionId)
      
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('Token expired')
      expect(mockRedisService.redisService.delete).toHaveBeenCalledWith(`csrf:${sessionId}:${token}`)
    })

    it('should reject token with invalid hash', async () => {
      mockCrypto.timingSafeEqual = jest.fn().mockReturnValue(false)
      
      const token = 'invalid-token'
      const sessionId = 'session-123'
      const tokenInfo: CsrfTokenInfo = {
        token,
        hash: 'invalid-hash',
        expiresAt: Date.now() + 3600000,
        sessionId,
        userId: 'user123',
        tenantId: 'tenant1',
      }
      
      mockRedisService.redisService.get = jest.fn().mockResolvedValue(JSON.stringify(tokenInfo))
      
      const result = await csrfProtection.validateCsrfToken(token, sessionId)
      
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('Token verification failed')
    })

    it('should reject token with session mismatch', async () => {
      const token = 'valid-token'
      const sessionId = 'session-123'
      const tokenInfo: CsrfTokenInfo = {
        token,
        hash: 'mocked-hash',
        expiresAt: Date.now() + 3600000,
        sessionId: 'different-session',
        userId: 'user123',
        tenantId: 'tenant1',
      }
      
      mockRedisService.redisService.get = jest.fn().mockResolvedValue(JSON.stringify(tokenInfo))
      
      const result = await csrfProtection.validateCsrfToken(token, sessionId)
      
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('Session mismatch')
    })

    it('should handle validation errors gracefully', async () => {
      mockRedisService.redisService.get = jest.fn().mockRejectedValue(new Error('Redis error'))
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
      
      const result = await csrfProtection.validateCsrfToken('token', 'session-123')
      
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('Validation error')
      expect(consoleSpy).toHaveBeenCalledWith('CSRF token validation error:', expect.any(Error))
      
      consoleSpy.mockRestore()
    })
  })

  describe('Cookie management', () => {
    it('should create CSRF cookie with correct attributes', () => {
      const token = 'test-token'
      const cookie = csrfProtection.createCsrfCookie(token)
      
      expect(cookie).toContain('keyfront.csrf=test-token')
      expect(cookie).toContain('Max-Age=3600')
      expect(cookie).toContain('SameSite=lax')
      expect(cookie).toContain('Path=/')
    })

    it('should include Secure flag in production', () => {
      const csrf = new CsrfProtection({ secure: true })
      const cookie = csrf.createCsrfCookie('test-token')
      expect(cookie).toContain('Secure')
    })

    it('should include HttpOnly flag when configured', () => {
      const csrf = new CsrfProtection({ httpOnly: true })
      const cookie = csrf.createCsrfCookie('test-token')
      expect(cookie).toContain('HttpOnly')
    })
  })

  describe('Token extraction', () => {
    it('should extract token from header', () => {
      const request = new NextRequest('http://localhost:3000/api/test', {
        headers: {
          'x-csrf-token': 'header-token'
        }
      })
      
      const token = csrfProtection.extractToken(request)
      expect(token).toBe('header-token')
    })

    it('should fall back to cookie when header is missing', () => {
      const request = new NextRequest('http://localhost:3000/api/test', {
        headers: {
          'cookie': 'keyfront.csrf=cookie-token'
        }
      })
      
      // Mock cookies.get method
      request.cookies.get = jest.fn().mockReturnValue({ value: 'cookie-token' })
      
      const token = csrfProtection.extractToken(request)
      expect(token).toBe('cookie-token')
    })

    it('should return null when no token found', () => {
      const request = new NextRequest('http://localhost:3000/api/test')
      request.cookies.get = jest.fn().mockReturnValue(undefined)
      
      const token = csrfProtection.extractToken(request)
      expect(token).toBeNull()
    })
  })

  describe('Method protection', () => {
    it('should require protection for state-changing methods', () => {
      expect(csrfProtection.requiresProtection('POST')).toBe(true)
      expect(csrfProtection.requiresProtection('PUT')).toBe(true)
      expect(csrfProtection.requiresProtection('DELETE')).toBe(true)
      expect(csrfProtection.requiresProtection('PATCH')).toBe(true)
    })

    it('should not require protection for safe methods', () => {
      expect(csrfProtection.requiresProtection('GET')).toBe(false)
      expect(csrfProtection.requiresProtection('HEAD')).toBe(false)
      expect(csrfProtection.requiresProtection('OPTIONS')).toBe(false)
    })

    it('should handle custom exclude methods', () => {
      const csrf = new CsrfProtection({ excludeMethods: ['GET', 'POST'] })
      expect(csrf.requiresProtection('POST')).toBe(false)
      expect(csrf.requiresProtection('PUT')).toBe(true)
    })
  })

  describe('Token cleanup and management', () => {
    beforeEach(() => {
      mockRedisService.redisService = {
        getKeysByPattern: jest.fn(),
        get: jest.fn(),
        delete: jest.fn().mockResolvedValue(1),
        deleteMultiple: jest.fn().mockResolvedValue(1),
      } as any
    })

    it('should clean up expired tokens', async () => {
      const sessionId = 'session-123'
      const expiredToken: CsrfTokenInfo = {
        token: 'expired',
        hash: 'hash',
        expiresAt: Date.now() - 1000,
        sessionId,
      }
      const validToken: CsrfTokenInfo = {
        token: 'valid',
        hash: 'hash',
        expiresAt: Date.now() + 3600000,
        sessionId,
      }
      
      mockRedisService.redisService.getKeysByPattern = jest.fn()
        .mockResolvedValue(['csrf:session-123:expired', 'csrf:session-123:valid'])
      mockRedisService.redisService.get = jest.fn()
        .mockResolvedValueOnce(JSON.stringify(expiredToken))
        .mockResolvedValueOnce(JSON.stringify(validToken))
      
      const cleaned = await csrfProtection.cleanupExpiredTokens(sessionId)
      
      expect(cleaned).toBe(1)
      expect(mockRedisService.redisService.delete).toHaveBeenCalledWith('csrf:session-123:expired')
    })

    it('should invalidate all session tokens', async () => {
      const sessionId = 'session-123'
      const keys = ['csrf:session-123:token1', 'csrf:session-123:token2']
      
      mockRedisService.redisService.getKeysByPattern = jest.fn().mockResolvedValue(keys)
      
      const count = await csrfProtection.invalidateSessionTokens(sessionId)
      
      expect(count).toBe(2)
      expect(mockRedisService.redisService.deleteMultiple).toHaveBeenCalledWith(keys)
    })

    it('should get token statistics', async () => {
      const now = Date.now()
      const expiredToken: CsrfTokenInfo = {
        token: 'expired',
        hash: 'hash',
        expiresAt: now - 1000,
        sessionId: 'session',
      }
      const validToken: CsrfTokenInfo = {
        token: 'valid',
        hash: 'hash',
        expiresAt: now + 3600000,
        sessionId: 'session',
      }
      
      mockRedisService.redisService.getKeysByPattern = jest.fn()
        .mockResolvedValue(['csrf:session:expired', 'csrf:session:valid'])
      mockRedisService.redisService.get = jest.fn()
        .mockResolvedValueOnce(JSON.stringify(expiredToken))
        .mockResolvedValueOnce(JSON.stringify(validToken))
      
      const stats = await csrfProtection.getTokenStats('session')
      
      expect(stats.totalTokens).toBe(2)
      expect(stats.expiredTokens).toBe(1)
      expect(stats.validTokens).toBe(1)
      expect(stats.sessionTokens).toBe(2)
    })

    it('should handle cleanup errors gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
      mockRedisService.redisService.getKeysByPattern = jest.fn().mockRejectedValue(new Error('Redis error'))
      
      const result = await csrfProtection.cleanupExpiredTokens('session')
      
      expect(result).toBe(0)
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })
  })
})

describe('withCsrfProtection middleware', () => {
  let mockHandler: jest.Mock
  let middlewareFunction: any

  beforeEach(() => {
    jest.clearAllMocks()
    mockTracing.generateTraceId.mockReturnValue('trace-789')
    
    mockRedisService.redisService = {
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn(),
    } as any
    
    mockHandler = jest.fn()
    middlewareFunction = withCsrfProtection(mockHandler)
  })

  it('should generate CSRF token for GET requests', async () => {
    const mockResponse = new NextResponse('success')
    mockResponse.headers.set = jest.fn()
    mockHandler.mockResolvedValue(mockResponse)
    
    const request = new NextRequest('http://localhost:3000/api/test', {
      method: 'GET',
      headers: {
        'cookie': 'keyfront.sid=session-123'
      }
    })
    request.cookies.get = jest.fn().mockReturnValue({ value: 'session-123' })
    
    const result = await middlewareFunction(request)
    
    expect(mockHandler).toHaveBeenCalledWith(request, expect.any(String))
    expect(mockResponse.headers.set).toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('keyfront.csrf='))
  })

  it('should validate CSRF token for POST requests', async () => {
    const tokenInfo: CsrfTokenInfo = {
      token: 'valid-token',
      hash: 'mocked-hash',
      expiresAt: Date.now() + 3600000,
      sessionId: 'session-123',
    }
    
    mockRedisService.redisService.get = jest.fn().mockResolvedValue(JSON.stringify(tokenInfo))
    
    const mockResponse = new NextResponse('success')
    mockResponse.headers.set = jest.fn()
    mockHandler.mockResolvedValue(mockResponse)
    
    const request = new NextRequest('http://localhost:3000/api/test', {
      method: 'POST',
      headers: {
        'x-csrf-token': 'valid-token',
        'cookie': 'keyfront.sid=session-123'
      }
    })
    request.cookies.get = jest.fn().mockReturnValue({ value: 'session-123' })
    
    const result = await middlewareFunction(request)
    
    expect(mockHandler).toHaveBeenCalledWith(request, 'valid-token')
    expect(mockResponse.headers.set).toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('keyfront.csrf='))
  })

  it('should reject POST requests without session', async () => {
    const request = new NextRequest('http://localhost:3000/api/test', {
      method: 'POST'
    })
    request.cookies.get = jest.fn().mockReturnValue(undefined)
    
    const result = await middlewareFunction(request)
    const responseData = await result.json()
    
    expect(result.status).toBe(401)
    expect(responseData.error.code).toBe('CSRF_NO_SESSION')
    expect(mockHandler).not.toHaveBeenCalled()
  })

  it('should reject POST requests without CSRF token', async () => {
    const request = new NextRequest('http://localhost:3000/api/test', {
      method: 'POST',
      headers: {
        'cookie': 'keyfront.sid=session-123'
      }
    })
    request.cookies.get = jest.fn().mockReturnValue({ value: 'session-123' })
    
    const result = await middlewareFunction(request)
    const responseData = await result.json()
    
    expect(result.status).toBe(403)
    expect(responseData.error.code).toBe('CSRF_MISSING_TOKEN')
    expect(mockHandler).not.toHaveBeenCalled()
  })

  it('should reject requests with invalid CSRF token', async () => {
    mockRedisService.redisService.get = jest.fn().mockResolvedValue(null)
    
    const request = new NextRequest('http://localhost:3000/api/test', {
      method: 'POST',
      headers: {
        'x-csrf-token': 'invalid-token',
        'cookie': 'keyfront.sid=session-123'
      }
    })
    request.cookies.get = jest.fn().mockReturnValue({ value: 'session-123' })
    
    const result = await middlewareFunction(request)
    const responseData = await result.json()
    
    expect(result.status).toBe(403)
    expect(responseData.error.code).toBe('CSRF_INVALID_TOKEN')
    expect(mockHandler).not.toHaveBeenCalled()
  })

  it('should handle middleware errors gracefully', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
    mockHandler.mockRejectedValue(new Error('Handler failed'))
    
    const request = new NextRequest('http://localhost:3000/api/test', {
      method: 'GET'
    })
    request.cookies.get = jest.fn().mockReturnValue(undefined)
    
    const result = await middlewareFunction(request)
    const responseData = await result.json()
    
    expect(result.status).toBe(500)
    expect(responseData.error.code).toBe('CSRF_ERROR')
    expect(consoleSpy).toHaveBeenCalled()
    
    consoleSpy.mockRestore()
  })
})

describe('Global CSRF instance', () => {
  it('should export a global CSRF protection instance', () => {
    expect(globalCsrf).toBeInstanceOf(CsrfProtection)
  })

  it('should be configurable via environment variables', () => {
    expect(globalCsrf['config']).toBeDefined()
    expect(globalCsrf['config'].cookieName).toBe('keyfront.csrf')
  })
})