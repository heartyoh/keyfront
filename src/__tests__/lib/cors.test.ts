import { CorsManager, CorsConfig, withCors, globalCors } from '../../lib/cors'
import { NextRequest, NextResponse } from 'next/server'
import * as tracingModule from '../../lib/tracing'

// Mock tracing module
jest.mock('../../lib/tracing')
const mockTracing = tracingModule as jest.Mocked<typeof tracingModule>

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
      })
    }),
  },
}))

describe('CorsManager', () => {
  let corsManager: CorsManager
  let mockRequest: NextRequest

  beforeEach(() => {
    jest.clearAllMocks()
    mockTracing.generateTraceId.mockReturnValue('trace-123')
    
    // Reset environment variables
    delete process.env.CORS_ORIGINS
    process.env.NODE_ENV = 'test'
    
    corsManager = new CorsManager()
    mockRequest = new NextRequest('http://localhost:3000/api/test', {
      method: 'GET',
      headers: {
        'origin': 'http://localhost:3000',
      },
    })
  })

  describe('Constructor and Configuration', () => {
    it('should create with default configuration', () => {
      const manager = new CorsManager()
      expect(manager['config']).toBeDefined()
      expect(manager['config'].methods).toEqual(['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'])
      expect(manager['config'].credentials).toBe(true)
      expect(manager['config'].maxAge).toBe(86400)
    })

    it('should parse CORS_ORIGINS environment variable', () => {
      process.env.CORS_ORIGINS = 'http://localhost:3000,https://example.com'
      const manager = new CorsManager()
      expect(manager['config'].origin).toEqual(['http://localhost:3000', 'https://example.com'])
    })

    it('should handle wildcard origin', () => {
      process.env.CORS_ORIGINS = '*'
      const manager = new CorsManager()
      expect(manager['config'].origin).toBe(true)
    })

    it('should handle disabled CORS', () => {
      process.env.CORS_ORIGINS = 'false'
      const manager = new CorsManager()
      expect(manager['config'].origin).toBe(false)
    })

    it('should merge custom configuration', () => {
      const config: CorsConfig = {
        maxAge: 3600,
        credentials: false,
        tenantOrigins: { 'tenant1': ['https://tenant1.com'] }
      }
      const manager = new CorsManager(config)
      expect(manager['config'].maxAge).toBe(3600)
      expect(manager['config'].credentials).toBe(false)
      expect(manager['config'].tenantOrigins).toEqual({ 'tenant1': ['https://tenant1.com'] })
    })
  })

  describe('Origin validation', () => {
    it('should allow localhost in development mode', () => {
      process.env.NODE_ENV = 'development'
      const manager = new CorsManager()
      
      const result = manager['isOriginAllowed']('http://localhost:3000')
      expect(result).toBe(true)
      
      const result2 = manager['isOriginAllowed']('http://127.0.0.1:8080')
      expect(result2).toBe(true)
    })

    it('should reject non-localhost origins in development without explicit config', () => {
      process.env.NODE_ENV = 'development'
      const manager = new CorsManager()
      
      const result = manager['isOriginAllowed']('https://malicious.com')
      expect(result).toBe(false)
    })

    it('should check tenant-specific origins', () => {
      const manager = new CorsManager({
        tenantOrigins: {
          'tenant1': ['https://tenant1.com'],
          'tenant2': ['https://tenant2.com', 'https://app.tenant2.com']
        }
      })

      expect(manager['isOriginAllowed']('https://tenant1.com', 'tenant1')).toBe(true)
      expect(manager['isOriginAllowed']('https://tenant2.com', 'tenant2')).toBe(true)
      expect(manager['isOriginAllowed']('https://tenant1.com', 'tenant2')).toBe(false)
    })

    it('should handle boolean origin configuration', () => {
      const allowAll = new CorsManager({ origin: true })
      expect(allowAll['isOriginAllowed']('https://any.com')).toBe(true)

      const allowNone = new CorsManager({ origin: false })
      expect(allowNone['isOriginAllowed']('https://any.com')).toBe(false)
    })

    it('should handle function origin configuration', () => {
      const originChecker = jest.fn((origin: string) => origin.endsWith('.trusted.com'))
      const manager = new CorsManager({ origin: originChecker })

      expect(manager['isOriginAllowed']('https://app.trusted.com')).toBe(true)
      expect(manager['isOriginAllowed']('https://malicious.com')).toBe(false)
      expect(originChecker).toHaveBeenCalledWith('https://app.trusted.com', null)
    })

    it('should handle array origin configuration', () => {
      const manager = new CorsManager({
        origin: ['https://app1.com', 'https://app2.com']
      })

      expect(manager['isOriginAllowed']('https://app1.com')).toBe(true)
      expect(manager['isOriginAllowed']('https://app2.com')).toBe(true)
      expect(manager['isOriginAllowed']('https://app3.com')).toBe(false)
    })

    it('should handle string origin configuration', () => {
      const manager = new CorsManager({ origin: 'https://only.com' })

      expect(manager['isOriginAllowed']('https://only.com')).toBe(true)
      expect(manager['isOriginAllowed']('https://other.com')).toBe(false)
    })

    it('should return false for undefined origin', () => {
      const manager = new CorsManager()
      expect(manager['isOriginAllowed'](undefined)).toBe(false)
    })
  })

  describe('CORS headers building', () => {
    it('should build basic CORS headers', () => {
      const manager = new CorsManager({ origin: true })
      const headers = manager['buildCorsHeaders']('https://app.com', 'GET', undefined)

      expect(headers['Access-Control-Allow-Origin']).toBe('https://app.com')
      expect(headers['Access-Control-Allow-Credentials']).toBe('true')
      expect(headers['Access-Control-Expose-Headers']).toContain('X-RateLimit-Limit')
    })

    it('should handle preflight OPTIONS requests', () => {
      const manager = new CorsManager({
        origin: true,
        methods: ['GET', 'POST'],
        maxAge: 7200
      })
      const headers = manager['buildCorsHeaders']('https://app.com', 'OPTIONS', 'content-type,authorization')

      expect(headers['Access-Control-Allow-Methods']).toBe('GET, POST')
      expect(headers['Access-Control-Max-Age']).toBe('7200')
      expect(headers['Access-Control-Allow-Headers']).toContain('Content-Type')
    })

    it('should validate requested headers against allowed headers', () => {
      const manager = new CorsManager({
        origin: true,
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Custom']
      })
      const headers = manager['buildCorsHeaders']('https://app.com', 'OPTIONS', 'content-type,x-malicious,authorization')

      const allowedHeaders = headers['Access-Control-Allow-Headers']
      expect(allowedHeaders).toContain('Content-Type')
      expect(allowedHeaders).toContain('Authorization')
      expect(allowedHeaders).not.toContain('x-malicious')
    })

    it('should not include origin header for disallowed origins', () => {
      const manager = new CorsManager({ origin: false })
      const headers = manager['buildCorsHeaders']('https://app.com', 'GET', undefined)

      expect(headers['Access-Control-Allow-Origin']).toBeUndefined()
    })

    it('should handle string methods configuration', () => {
      const manager = new CorsManager({
        origin: true,
        methods: 'GET, POST'
      })
      const headers = manager['buildCorsHeaders']('https://app.com', 'OPTIONS', undefined)

      expect(headers['Access-Control-Allow-Methods']).toBe('GET, POST')
    })
  })

  describe('Request handling', () => {
    it('should handle regular requests', () => {
      const manager = new CorsManager({ origin: true })
      const request = new NextRequest('http://localhost:3000/api/test', {
        method: 'GET',
        headers: { 'origin': 'https://app.com' }
      })

      const result = manager.handleRequest(request)

      expect(result.allowed).toBe(true)
      expect(result.shouldContinue).toBe(true)
      expect(result.headers['Access-Control-Allow-Origin']).toBe('https://app.com')
    })

    it('should handle preflight requests', () => {
      const manager = new CorsManager({ 
        origin: true,
        preflightContinue: false 
      })
      const request = new NextRequest('http://localhost:3000/api/test', {
        method: 'OPTIONS',
        headers: { 
          'origin': 'https://app.com',
          'access-control-request-headers': 'content-type'
        }
      })

      const result = manager.handleRequest(request)

      expect(result.allowed).toBe(true)
      expect(result.shouldContinue).toBe(false)
      expect(result.headers['Access-Control-Allow-Methods']).toBeDefined()
      expect(result.headers['Access-Control-Max-Age']).toBeDefined()
    })

    it('should reject disallowed origins', () => {
      const manager = new CorsManager({ 
        origin: ['https://allowed.com'] 
      })
      const request = new NextRequest('http://localhost:3000/api/test', {
        method: 'GET',
        headers: { 'origin': 'https://malicious.com' }
      })

      const result = manager.handleRequest(request)

      expect(result.allowed).toBe(false)
      expect(result.headers['Access-Control-Allow-Origin']).toBeUndefined()
    })

    it('should handle tenant-specific requests', () => {
      const manager = new CorsManager({
        tenantOrigins: {
          'tenant1': ['https://tenant1.com']
        }
      })
      const request = new NextRequest('http://localhost:3000/api/test', {
        method: 'GET',
        headers: { 'origin': 'https://tenant1.com' }
      })

      const result = manager.handleRequest(request, 'tenant1')

      expect(result.allowed).toBe(true)
      expect(result.headers['Access-Control-Allow-Origin']).toBe('https://tenant1.com')
    })
  })

  describe('Tenant management', () => {
    it('should add tenant origins', () => {
      const manager = new CorsManager()
      manager.addTenantOrigins('tenant1', ['https://tenant1.com', 'https://app.tenant1.com'])

      expect(manager['config'].tenantOrigins['tenant1']).toEqual(['https://tenant1.com', 'https://app.tenant1.com'])
    })

    it('should remove tenant origins', () => {
      const manager = new CorsManager({
        tenantOrigins: { 'tenant1': ['https://tenant1.com'] }
      })
      manager.removeTenantOrigins('tenant1')

      expect(manager['config'].tenantOrigins['tenant1']).toBeUndefined()
    })
  })
})

describe('withCors middleware', () => {
  let mockHandler: jest.Mock
  let middlewareFunction: any

  beforeEach(() => {
    jest.clearAllMocks()
    mockTracing.generateTraceId.mockReturnValue('trace-456')
    
    mockHandler = jest.fn()
    middlewareFunction = withCors(mockHandler, { origin: true })
  })

  it('should call handler and add CORS headers for allowed requests', async () => {
    const mockResponse = new NextResponse('success')
    mockResponse.headers.set = jest.fn()
    mockHandler.mockResolvedValue(mockResponse)

    const request = new NextRequest('http://localhost:3000/api/test', {
      method: 'GET',
      headers: { 'origin': 'https://app.com' }
    })

    const result = await middlewareFunction(request)

    expect(mockHandler).toHaveBeenCalledWith(request)
    expect(mockResponse.headers.set).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://app.com')
    expect(result).toBe(mockResponse)
  })

  it('should block disallowed origins', async () => {
    const corsMiddleware = withCors(mockHandler, { 
      origin: ['https://allowed.com'] 
    })

    const request = new NextRequest('http://localhost:3000/api/test', {
      method: 'GET',
      headers: { 'origin': 'https://malicious.com' }
    })

    const result = await corsMiddleware(request)
    const responseData = await result.json()

    expect(mockHandler).not.toHaveBeenCalled()
    expect(result.status).toBe(403)
    expect(responseData.error.code).toBe('CORS_FORBIDDEN')
    expect(responseData.error.traceId).toBe('trace-456')
  })

  it('should handle preflight requests without calling handler', async () => {
    const corsMiddleware = withCors(mockHandler, { 
      origin: true,
      preflightContinue: false,
      optionsSuccessStatus: 204
    })

    const request = new NextRequest('http://localhost:3000/api/test', {
      method: 'OPTIONS',
      headers: { 
        'origin': 'https://app.com',
        'access-control-request-headers': 'content-type'
      }
    })

    const result = await corsMiddleware(request)

    expect(mockHandler).not.toHaveBeenCalled()
    expect(result.status).toBe(204)
    expect(result.headers.get('Access-Control-Allow-Origin')).toBe('https://app.com')
  })

  it('should continue with preflight when preflightContinue is true', async () => {
    const mockResponse = new NextResponse('preflight handled')
    mockResponse.headers.set = jest.fn()
    mockHandler.mockResolvedValue(mockResponse)

    const corsMiddleware = withCors(mockHandler, { 
      origin: true,
      preflightContinue: true
    })

    const request = new NextRequest('http://localhost:3000/api/test', {
      method: 'OPTIONS',
      headers: { 
        'origin': 'https://app.com',
        'access-control-request-headers': 'content-type'
      }
    })

    const result = await corsMiddleware(request)

    expect(mockHandler).toHaveBeenCalledWith(request)
    expect(result).toBe(mockResponse)
  })

  it('should extract tenant ID from headers', async () => {
    const mockResponse = new NextResponse('success')
    mockResponse.headers.set = jest.fn()
    mockHandler.mockResolvedValue(mockResponse)

    const corsMiddleware = withCors(mockHandler, {
      tenantOrigins: {
        'tenant1': ['https://tenant1.com']
      }
    })

    const request = new NextRequest('http://localhost:3000/api/test', {
      method: 'GET',
      headers: { 
        'origin': 'https://tenant1.com',
        'x-keyfront-tenant-id': 'tenant1'
      }
    })

    const result = await corsMiddleware(request)

    expect(mockHandler).toHaveBeenCalledWith(request)
    expect(mockResponse.headers.set).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://tenant1.com')
  })

  it('should handle handler errors gracefully', async () => {
    mockHandler.mockRejectedValue(new Error('Handler failed'))

    const request = new NextRequest('http://localhost:3000/api/test', {
      method: 'GET',
      headers: { 'origin': 'https://app.com' }
    })

    const result = await middlewareFunction(request)
    const responseData = await result.json()

    expect(result.status).toBe(500)
    expect(responseData.error.code).toBe('CORS_ERROR')
    expect(responseData.error.traceId).toBe('trace-456')
  })
})

describe('Global CORS instance', () => {
  it('should export a global CORS manager instance', () => {
    expect(globalCors).toBeInstanceOf(CorsManager)
  })

  it('should be configurable via environment variables', () => {
    // This tests that the global instance picks up environment configuration
    expect(globalCors['config']).toBeDefined()
    expect(globalCors['config'].credentials).toBe(true)
  })
})