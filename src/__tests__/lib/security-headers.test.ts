import { SecurityHeadersManager, SecurityHeadersConfig, withSecurityHeaders, globalSecurityHeaders } from '../../lib/security-headers'
import { NextRequest, NextResponse } from 'next/server'
import * as tracingModule from '../../lib/tracing'

// Mock tracing module
jest.mock('../../lib/tracing')
const mockTracing = tracingModule as jest.Mocked<typeof tracingModule>

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

describe('SecurityHeadersManager', () => {
  let securityHeaders: SecurityHeadersManager
  let mockRequest: NextRequest

  beforeEach(() => {
    jest.clearAllMocks()
    mockTracing.generateTraceId.mockReturnValue('trace-123')
    
    securityHeaders = new SecurityHeadersManager()
    mockRequest = new NextRequest('http://localhost:3000/api/test')
  })

  describe('Constructor and Configuration', () => {
    it('should create with default configuration', () => {
      const manager = new SecurityHeadersManager()
      expect(manager['config']).toBeDefined()
      expect(manager['config'].frameOptions).toBe('DENY')
      expect(manager['config'].contentTypeOptions).toBe(true)
      expect(manager['config'].referrerPolicy).toBe('strict-origin-when-cross-origin')
    })

    it('should merge custom configuration', () => {
      const config: SecurityHeadersConfig = {
        frameOptions: 'SAMEORIGIN',
        referrerPolicy: 'no-referrer',
        crossOriginResourcePolicy: 'same-origin'
      }
      const manager = new SecurityHeadersManager(config)
      
      expect(manager['config'].frameOptions).toBe('SAMEORIGIN')
      expect(manager['config'].referrerPolicy).toBe('no-referrer')
      expect(manager['config'].crossOriginResourcePolicy).toBe('same-origin')
    })

    it('should have secure default CSP configuration', () => {
      const manager = new SecurityHeadersManager()
      const csp = manager['config'].contentSecurityPolicy!
      
      expect(csp.directives['default-src']).toEqual(["'self'"])
      expect(csp.directives['object-src']).toEqual(["'none'"])
      expect(csp.directives['frame-ancestors']).toEqual(["'none'"])
      expect(csp.reportOnly).toBe(false)
    })

    it('should have secure HSTS default configuration', () => {
      const manager = new SecurityHeadersManager()
      const hsts = manager['config'].strictTransportSecurity!
      
      expect(hsts.maxAge).toBe(31536000) // 1 year
      expect(hsts.includeSubDomains).toBe(true)
      expect(hsts.preload).toBe(true)
    })

    it('should have restrictive permissions policy by default', () => {
      const manager = new SecurityHeadersManager()
      const permissions = manager['config'].permissionsPolicy!
      
      expect(permissions['camera']).toEqual([])
      expect(permissions['microphone']).toEqual([])
      expect(permissions['geolocation']).toEqual([])
    })
  })

  describe('CSP String Building', () => {
    it('should build CSP string from directives', () => {
      const manager = new SecurityHeadersManager({
        contentSecurityPolicy: {
          directives: {
            'default-src': ["'self'"],
            'script-src': ["'self'", "'unsafe-inline'"],
            'style-src': ["'self'"],
            'upgrade-insecure-requests': []
          }
        }
      })
      
      const csp = manager['buildCSPString']()
      
      expect(csp).toContain("default-src 'self'")
      expect(csp).toContain("script-src 'self' 'unsafe-inline'")
      expect(csp).toContain("style-src 'self'")
      expect(csp).toContain("upgrade-insecure-requests")
    })

    it('should handle empty directive arrays correctly', () => {
      const manager = new SecurityHeadersManager({
        contentSecurityPolicy: {
          directives: {
            'upgrade-insecure-requests': [],
            'block-all-mixed-content': []
          }
        }
      })
      
      const csp = manager['buildCSPString']()
      
      expect(csp).toContain('upgrade-insecure-requests')
      expect(csp).toContain('block-all-mixed-content')
      expect(csp).not.toContain('upgrade-insecure-requests ')
    })

    it('should handle string directives', () => {
      const manager = new SecurityHeadersManager({
        contentSecurityPolicy: {
          directives: {
            'report-uri': '/csp-report'
          }
        }
      })
      
      const csp = manager['buildCSPString']()
      expect(csp).toContain('report-uri /csp-report')
    })
  })

  describe('HSTS String Building', () => {
    it('should build HSTS string with all options', () => {
      const manager = new SecurityHeadersManager({
        strictTransportSecurity: {
          maxAge: 3600,
          includeSubDomains: true,
          preload: true
        }
      })
      
      const hsts = manager['buildHSTSString']()
      
      expect(hsts).toBe('max-age=3600; includeSubDomains; preload')
    })

    it('should build HSTS string with only maxAge', () => {
      const manager = new SecurityHeadersManager({
        strictTransportSecurity: {
          maxAge: 7200,
          includeSubDomains: false,
          preload: false
        }
      })
      
      const hsts = manager['buildHSTSString']()
      
      expect(hsts).toBe('max-age=7200')
    })
  })

  describe('Permissions Policy String Building', () => {
    it('should build permissions policy string', () => {
      const manager = new SecurityHeadersManager({
        permissionsPolicy: {
          'camera': [],
          'microphone': ['self'],
          'geolocation': ['self', 'https://example.com']
        }
      })
      
      const policy = manager['buildPermissionsPolicyString']()
      
      expect(policy).toContain('camera=()')
      expect(policy).toContain('microphone=(self)')
      expect(policy).toContain('geolocation=(self https://example.com)')
    })

    it('should handle empty permissions policy', () => {
      const manager = new SecurityHeadersManager({
        permissionsPolicy: {}
      })
      
      const policy = manager['buildPermissionsPolicyString']()
      expect(policy).toBe('')
    })
  })

  describe('Expect-CT String Building', () => {
    it('should build Expect-CT string with all options', () => {
      const manager = new SecurityHeadersManager({
        expectCt: {
          maxAge: 86400,
          enforce: true,
          reportUri: 'https://example.com/ct-report'
        }
      })
      
      const expectCt = manager['buildExpectCtString']()
      
      expect(expectCt).toBe('max-age=86400, enforce, report-uri="https://example.com/ct-report"')
    })

    it('should build Expect-CT string with only maxAge', () => {
      const manager = new SecurityHeadersManager({
        expectCt: {
          maxAge: 3600,
          enforce: false
        }
      })
      
      const expectCt = manager['buildExpectCtString']()
      
      expect(expectCt).toBe('max-age=3600')
    })
  })

  describe('HPKP String Building', () => {
    it('should build HPKP string with all options', () => {
      const manager = new SecurityHeadersManager({
        hpkp: {
          pins: ['pin1', 'pin2'],
          maxAge: 2592000,
          includeSubDomains: true,
          reportUri: 'https://example.com/hpkp-report'
        }
      })
      
      const hpkp = manager['buildHPKPString']()
      
      expect(hpkp).toBe('pin-sha256="pin1"; pin-sha256="pin2"; max-age=2592000; includeSubDomains; report-uri="https://example.com/hpkp-report"')
    })

    it('should build HPKP string with minimum options', () => {
      const manager = new SecurityHeadersManager({
        hpkp: {
          pins: ['pin1'],
          maxAge: 86400
        }
      })
      
      const hpkp = manager['buildHPKPString']()
      
      expect(hpkp).toBe('pin-sha256="pin1"; max-age=86400')
    })
  })

  describe('Security Headers Generation', () => {
    it('should generate all security headers for HTTP', () => {
      const manager = new SecurityHeadersManager()
      const headers = manager.getSecurityHeaders(mockRequest, false)

      expect(headers['Content-Security-Policy']).toBeDefined()
      expect(headers['X-Frame-Options']).toBe('DENY')
      expect(headers['X-Content-Type-Options']).toBe('nosniff')
      expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
      expect(headers['Permissions-Policy']).toBeDefined()
      expect(headers['Cross-Origin-Embedder-Policy']).toBe('unsafe-none')
      expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin')
      expect(headers['Cross-Origin-Resource-Policy']).toBe('cross-origin')
      expect(headers['X-DNS-Prefetch-Control']).toBe('off')
      expect(headers['X-Download-Options']).toBe('noopen')
      expect(headers['Origin-Agent-Cluster']).toBe('?1')
      expect(headers['X-XSS-Protection']).toBe('1; mode=block')

      // HTTPS-only headers should not be present for HTTP
      expect(headers['Strict-Transport-Security']).toBeUndefined()
      expect(headers['Expect-CT']).toBeUndefined()
      expect(headers['Public-Key-Pins']).toBeUndefined()
    })

    it('should generate HTTPS-specific headers for HTTPS', () => {
      const manager = new SecurityHeadersManager()
      const httpsRequest = new NextRequest('https://example.com/api/test')
      const headers = manager.getSecurityHeaders(httpsRequest, true)

      expect(headers['Strict-Transport-Security']).toBeDefined()
      expect(headers['Expect-CT']).toBeDefined()
    })

    it('should use CSP report-only when configured', () => {
      const manager = new SecurityHeadersManager({
        contentSecurityPolicy: {
          directives: { 'default-src': ["'self'"] },
          reportOnly: true
        }
      })
      
      const headers = manager.getSecurityHeaders(mockRequest, false)
      
      expect(headers['Content-Security-Policy-Report-Only']).toBeDefined()
      expect(headers['Content-Security-Policy']).toBeUndefined()
    })

    it('should handle DNS prefetch control ON', () => {
      const manager = new SecurityHeadersManager({
        dnsPrefetchControl: true
      })
      
      const headers = manager.getSecurityHeaders(mockRequest, false)
      
      expect(headers['X-DNS-Prefetch-Control']).toBe('on')
    })

    it('should omit disabled headers', () => {
      const manager = new SecurityHeadersManager({
        frameOptions: undefined,
        contentTypeOptions: false,
        referrerPolicy: undefined,
        permissionsPolicy: undefined,
        ieNoOpen: false,
        noSniff: false,
        originAgentCluster: false,
        xssFilter: false
      })
      
      const headers = manager.getSecurityHeaders(mockRequest, false)
      
      expect(headers['X-Frame-Options']).toBeUndefined()
      expect(headers['X-Content-Type-Options']).toBeUndefined()
      expect(headers['Referrer-Policy']).toBeUndefined()
      expect(headers['Permissions-Policy']).toBeUndefined()
      expect(headers['X-Download-Options']).toBeUndefined()
      expect(headers['Origin-Agent-Cluster']).toBeUndefined()
      expect(headers['X-XSS-Protection']).toBeUndefined()
    })

    it('should handle ALLOW-FROM frame options', () => {
      const manager = new SecurityHeadersManager({
        frameOptions: 'ALLOW-FROM https://example.com'
      })
      
      const headers = manager.getSecurityHeaders(mockRequest, false)
      
      expect(headers['X-Frame-Options']).toBe('ALLOW-FROM https://example.com')
    })

    it('should handle HPKP configuration', () => {
      const manager = new SecurityHeadersManager({
        hpkp: {
          pins: ['pin1', 'pin2'],
          maxAge: 86400
        }
      })
      
      const headers = manager.getSecurityHeaders(mockRequest, true) // HTTPS required
      
      expect(headers['Public-Key-Pins']).toContain('pin-sha256="pin1"')
      expect(headers['Public-Key-Pins']).toContain('pin-sha256="pin2"')
    })
  })

  describe('Environment-specific configurations', () => {
    it('should create development configuration', () => {
      const devManager = SecurityHeadersManager.development()
      const headers = devManager.getSecurityHeaders(mockRequest, false)

      expect(headers['Content-Security-Policy-Report-Only']).toBeDefined() // Report-only in dev
      expect(headers['X-Frame-Options']).toBe('SAMEORIGIN') // Less strict
      expect(headers['Cross-Origin-Resource-Policy']).toBe('cross-origin')
      expect(headers['Strict-Transport-Security']).toBeUndefined() // Disabled in dev
    })

    it('should have permissive CSP in development', () => {
      const devManager = SecurityHeadersManager.development()
      const csp = devManager['buildCSPString']()

      expect(csp).toContain('localhost:*')
      expect(csp).toContain('http://localhost:*')
      expect(csp).toContain('ws://localhost:*')
      expect(csp).toContain("'unsafe-eval'")
    })

    it('should create production configuration', () => {
      const prodManager = SecurityHeadersManager.production()
      const headers = prodManager.getSecurityHeaders(mockRequest, true)

      expect(headers['Content-Security-Policy']).toBeDefined() // Enforced in prod
      expect(headers['X-Frame-Options']).toBe('DENY') // Strict
      expect(headers['Cross-Origin-Resource-Policy']).toBe('same-origin')
      expect(headers['Strict-Transport-Security']).toBeDefined() // Enabled in prod
    })

    it('should have strict CSP in production', () => {
      const prodManager = SecurityHeadersManager.production()
      const csp = prodManager['buildCSPString']()

      expect(csp).not.toContain('localhost')
      expect(csp).not.toContain("'unsafe-eval'")
      expect(csp).toContain("'self'")
      expect(csp).toContain("'none'")
    })

    it('should have longer HSTS maxAge in production', () => {
      const prodManager = SecurityHeadersManager.production()
      const hsts = prodManager['buildHSTSString']()

      expect(hsts).toContain('max-age=63072000') // 2 years
      expect(hsts).toContain('includeSubDomains')
      expect(hsts).toContain('preload')
    })
  })
})

describe('withSecurityHeaders middleware', () => {
  let mockHandler: jest.Mock
  let middlewareFunction: any

  beforeEach(() => {
    jest.clearAllMocks()
    mockTracing.generateTraceId.mockReturnValue('trace-456')
    
    mockHandler = jest.fn()
    middlewareFunction = withSecurityHeaders(mockHandler)
  })

  it('should apply security headers to response', async () => {
    const mockResponse = new NextResponse('success')
    mockResponse.headers.set = jest.fn()
    mockHandler.mockResolvedValue(mockResponse)

    const request = new NextRequest('http://localhost:3000/api/test')
    const result = await middlewareFunction(request)

    expect(mockHandler).toHaveBeenCalledWith(request)
    expect(mockResponse.headers.set).toHaveBeenCalledWith('Content-Security-Policy', expect.any(String))
    expect(mockResponse.headers.set).toHaveBeenCalledWith('X-Frame-Options', 'SAMEORIGIN')
    expect(mockResponse.headers.set).toHaveBeenCalledWith('x-keyfront-trace-id', 'trace-456')
  })

  it('should detect HTTPS from URL', async () => {
    const mockResponse = new NextResponse('success')
    mockResponse.headers.set = jest.fn()
    mockHandler.mockResolvedValue(mockResponse)

    const httpsRequest = new NextRequest('https://example.com/api/test')
    const result = await middlewareFunction(httpsRequest)

    expect(mockResponse.headers.set).toHaveBeenCalledWith('Strict-Transport-Security', expect.any(String))
  })

  it('should detect HTTPS from x-forwarded-proto header', async () => {
    const mockResponse = new NextResponse('success')
    mockResponse.headers.set = jest.fn()
    mockHandler.mockResolvedValue(mockResponse)

    const request = new NextRequest('http://localhost:3000/api/test', {
      headers: {
        'x-forwarded-proto': 'https'
      }
    })
    const result = await middlewareFunction(request)

    expect(mockResponse.headers.set).toHaveBeenCalledWith('Strict-Transport-Security', expect.any(String))
  })

  it('should use custom configuration when provided', async () => {
    const customMiddleware = withSecurityHeaders(mockHandler, {
      frameOptions: 'DENY',
      referrerPolicy: 'no-referrer'
    })

    const mockResponse = new NextResponse('success')
    mockResponse.headers.set = jest.fn()
    mockHandler.mockResolvedValue(mockResponse)

    const request = new NextRequest('http://localhost:3000/api/test')
    const result = await customMiddleware(request)

    expect(mockResponse.headers.set).toHaveBeenCalledWith('X-Frame-Options', 'DENY')
    expect(mockResponse.headers.set).toHaveBeenCalledWith('Referrer-Policy', 'no-referrer')
  })

  it('should use production config in production environment', async () => {
    process.env.NODE_ENV = 'production'
    const prodMiddleware = withSecurityHeaders(mockHandler)

    const mockResponse = new NextResponse('success')
    mockResponse.headers.set = jest.fn()
    mockHandler.mockResolvedValue(mockResponse)

    const request = new NextRequest('https://example.com/api/test')
    const result = await prodMiddleware(request)

    expect(mockResponse.headers.set).toHaveBeenCalledWith('X-Frame-Options', 'DENY')
    expect(mockResponse.headers.set).toHaveBeenCalledWith('Cross-Origin-Resource-Policy', 'same-origin')

    process.env.NODE_ENV = 'test' // Reset
  })

  it('should use development config in development environment', async () => {
    process.env.NODE_ENV = 'development'
    const devMiddleware = withSecurityHeaders(mockHandler)

    const mockResponse = new NextResponse('success')
    mockResponse.headers.set = jest.fn()
    mockHandler.mockResolvedValue(mockResponse)

    const request = new NextRequest('http://localhost:3000/api/test')
    const result = await devMiddleware(request)

    expect(mockResponse.headers.set).toHaveBeenCalledWith('Content-Security-Policy-Report-Only', expect.any(String))
    expect(mockResponse.headers.set).toHaveBeenCalledWith('X-Frame-Options', 'SAMEORIGIN')

    process.env.NODE_ENV = 'test' // Reset
  })

  it('should handle middleware errors gracefully', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
    mockHandler.mockRejectedValue(new Error('Handler failed'))

    const request = new NextRequest('http://localhost:3000/api/test')
    const result = await middlewareFunction(request)
    const responseData = await result.json()

    expect(result.status).toBe(500)
    expect(responseData.error.code).toBe('SECURITY_HEADERS_ERROR')
    expect(responseData.error.traceId).toBe('trace-456')
    expect(consoleSpy).toHaveBeenCalledWith('Security headers middleware error:', expect.any(Error))

    consoleSpy.mockRestore()
  })

  it('should apply all required security headers', async () => {
    const mockResponse = new NextResponse('success')
    const setHeaderCalls: string[] = []
    mockResponse.headers.set = jest.fn((key, value) => {
      setHeaderCalls.push(key)
    })
    mockHandler.mockResolvedValue(mockResponse)

    const request = new NextRequest('https://example.com/api/test')
    await middlewareFunction(request)

    const expectedHeaders = [
      'Content-Security-Policy-Report-Only', // Development mode
      'X-Frame-Options',
      'X-Content-Type-Options', 
      'Referrer-Policy',
      'Permissions-Policy',
      'Cross-Origin-Embedder-Policy',
      'Cross-Origin-Opener-Policy',
      'Cross-Origin-Resource-Policy',
      'X-DNS-Prefetch-Control',
      'X-Download-Options',
      'Origin-Agent-Cluster',
      'X-XSS-Protection',
      'x-keyfront-trace-id'
    ]

    expectedHeaders.forEach(header => {
      expect(setHeaderCalls).toContain(header)
    })
  })
})

describe('Global security headers instance', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test'
  })

  it('should export a global security headers manager', () => {
    expect(globalSecurityHeaders).toBeInstanceOf(SecurityHeadersManager)
  })

  it('should use production config when NODE_ENV is production', () => {
    process.env.NODE_ENV = 'production'
    
    // Re-import to get fresh instance
    jest.resetModules()
    const { globalSecurityHeaders: prodGlobal } = require('../../lib/security-headers')
    
    const headers = prodGlobal.getSecurityHeaders(new NextRequest('https://example.com'), true)
    expect(headers['X-Frame-Options']).toBe('DENY')
    expect(headers['Cross-Origin-Resource-Policy']).toBe('same-origin')

    process.env.NODE_ENV = 'test' // Reset
  })

  it('should use development config when NODE_ENV is not production', () => {
    process.env.NODE_ENV = 'development'
    
    // Re-import to get fresh instance
    jest.resetModules()
    const { globalSecurityHeaders: devGlobal } = require('../../lib/security-headers')
    
    const headers = devGlobal.getSecurityHeaders(new NextRequest('http://localhost:3000'), false)
    expect(headers['Content-Security-Policy-Report-Only']).toBeDefined()
    expect(headers['X-Frame-Options']).toBe('SAMEORIGIN')

    process.env.NODE_ENV = 'test' // Reset
  })
})