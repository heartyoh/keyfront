import { InputValidator, ValidationConfig, ValidationResult, withValidation, CommonSchemas, globalValidator } from '../../lib/validation'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import * as tracingModule from '../../lib/tracing'
import * as securityScannerModule from '../../lib/security-scanner'
import DOMPurify from 'isomorphic-dompurify'

// Mock dependencies
jest.mock('../../lib/tracing')
jest.mock('../../lib/security-scanner')
jest.mock('isomorphic-dompurify', () => ({
  sanitize: jest.fn()
}))

const mockTracing = tracingModule as jest.Mocked<typeof tracingModule>
const mockSecurityScanner = securityScannerModule as jest.Mocked<typeof securityScannerModule>
const mockDOMPurify = DOMPurify as jest.Mocked<typeof DOMPurify>

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
      return response
    }),
  },
}))

describe('InputValidator', () => {
  let validator: InputValidator
  let mockSecurityScannerInstance: any

  beforeEach(() => {
    jest.clearAllMocks()
    mockTracing.generateTraceId.mockReturnValue('trace-123')
    
    // Mock security scanner
    mockSecurityScannerInstance = {
      scanBatch: jest.fn().mockResolvedValue({
        field1: { threats: [], blocked: false },
        field2: { threats: [], blocked: false }
      })
    }
    mockSecurityScanner.globalSecurityScanner = mockSecurityScannerInstance
    
    // Mock DOMPurify
    mockDOMPurify.sanitize.mockImplementation((html) => html.replace(/<script>/g, ''))
    
    validator = new InputValidator()
  })

  describe('Constructor and Configuration', () => {
    it('should create with default configuration', () => {
      const defaultValidator = new InputValidator()
      expect(defaultValidator['config'].sanitizeHtml).toBe(true)
      expect(defaultValidator['config'].maxStringLength).toBe(10000)
      expect(defaultValidator['config'].maxArrayLength).toBe(1000)
      expect(defaultValidator['config'].enableSecurityScanning).toBe(true)
    })

    it('should merge custom configuration', () => {
      const config: ValidationConfig = {
        sanitizeHtml: false,
        maxStringLength: 500,
        allowedFileTypes: ['text/plain'],
        blockOnSecurityThreats: false
      }
      const customValidator = new InputValidator(config)
      
      expect(customValidator['config'].sanitizeHtml).toBe(false)
      expect(customValidator['config'].maxStringLength).toBe(500)
      expect(customValidator['config'].allowedFileTypes).toEqual(['text/plain'])
      expect(customValidator['config'].blockOnSecurityThreats).toBe(false)
    })

    it('should set blockOnSecurityThreats based on NODE_ENV', () => {
      process.env.NODE_ENV = 'production'
      const prodValidator = new InputValidator()
      expect(prodValidator['config'].blockOnSecurityThreats).toBe(true)
      
      process.env.NODE_ENV = 'development'
      const devValidator = new InputValidator()
      expect(devValidator['config'].blockOnSecurityThreats).toBe(false)
      
      process.env.NODE_ENV = 'test' // Reset
    })
  })

  describe('HTML Sanitization', () => {
    it('should sanitize HTML using DOMPurify when enabled', () => {
      const htmlValidator = new InputValidator({ sanitizeHtml: true })
      const maliciousHtml = '<script>alert("xss")</script><p>Safe content</p>'
      
      const result = htmlValidator['sanitizeValue'](maliciousHtml)
      
      expect(mockDOMPurify.sanitize).toHaveBeenCalledWith(maliciousHtml, {
        ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'ol', 'ul', 'li', 'a', 'span'],
        ALLOWED_ATTR: ['href', 'title', 'class'],
        ALLOW_DATA_ATTR: false,
      })
    })

    it('should strip HTML tags when stripTags is enabled', () => {
      const stripValidator = new InputValidator({ stripTags: true })
      const htmlContent = '<p>Hello <strong>world</strong>!</p>'
      
      const result = stripValidator['sanitizeValue'](htmlContent)
      
      expect(result).toBe('Hello world!')
    })

    it('should skip HTML sanitization when disabled', () => {
      const noSanitizeValidator = new InputValidator({ sanitizeHtml: false, stripTags: false })
      const htmlContent = '<script>alert("test")</script>'
      
      const result = noSanitizeValidator['sanitizeValue'](htmlContent)
      
      expect(mockDOMPurify.sanitize).not.toHaveBeenCalled()
      expect(result).toContain('<script>')
    })
  })

  describe('Value Sanitization', () => {
    it('should handle null and undefined values', () => {
      expect(validator['sanitizeValue'](null)).toBeNull()
      expect(validator['sanitizeValue'](undefined)).toBeUndefined()
    })

    it('should trim whitespace from strings', () => {
      const result = validator['sanitizeValue']('  hello world  ')
      expect(result).toBe('hello world')
    })

    it('should truncate strings exceeding max length', () => {
      const longString = 'a'.repeat(15000)
      const result = validator['sanitizeValue'](longString)
      expect(result.length).toBe(10000)
    })

    it('should filter SQL injection patterns', () => {
      const sqlInput = "'; DROP TABLE users; --"
      const result = validator['sanitizeValue'](sqlInput)
      expect(result).toContain('[FILTERED]')
      expect(result).not.toContain('DROP')
    })

    it('should filter XSS patterns', () => {
      const xssInput = 'javascript:alert("xss")'
      const result = validator['sanitizeValue'](xssInput)
      expect(result).toBe('[FILTERED]:alert("xss")')
    })

    it('should handle event handler patterns', () => {
      const eventInput = '<img onerror="alert(1)" src="x">'
      const result = validator['sanitizeValue'](eventInput)
      expect(result).toContain('[FILTERED]=')
    })

    it('should limit array length', () => {
      const longArray = new Array(1500).fill('item')
      const result = validator['sanitizeValue'](longArray)
      expect(result.length).toBe(1000)
    })

    it('should recursively sanitize array elements', () => {
      const arrayWithBadData = ['  normal  ', '<script>bad</script>', 'clean']
      const result = validator['sanitizeValue'](arrayWithBadData)
      
      expect(result[0]).toBe('normal')
      expect(result[1]).not.toContain('<script>')
      expect(result[2]).toBe('clean')
    })

    it('should limit object keys', () => {
      const largeObject = Object.fromEntries(
        Array.from({ length: 150 }, (_, i) => [`key${i}`, `value${i}`])
      )
      const result = validator['sanitizeValue'](largeObject)
      expect(Object.keys(result).length).toBe(100)
    })

    it('should recursively sanitize object values', () => {
      const objectWithBadData = {
        name: '  John Doe  ',
        bio: '<script>alert("hack")</script>',
        tags: ['  tag1  ', 'SELECT * FROM users']
      }
      
      const result = validator['sanitizeValue'](objectWithBadData)
      
      expect(result.name).toBe('John Doe')
      expect(result.bio).not.toContain('<script>')
      expect(result.tags[0]).toBe('tag1')
      expect(result.tags[1]).toContain('[FILTERED]')
    })

    it('should apply custom sanitizers', () => {
      const customValidator = new InputValidator({
        customSanitizers: {
          'username': (value) => value.toLowerCase().replace(/[^a-z0-9]/g, ''),
          'email': (value) => value.toLowerCase()
        }
      })
      
      const usernameResult = customValidator['sanitizeValue']('John123!@#', 'username')
      const emailResult = customValidator['sanitizeValue']('USER@EXAMPLE.COM', 'email')
      
      expect(usernameResult).toBe('john123')
      expect(emailResult).toBe('user@example.com')
    })

    it('should handle nested object paths for custom sanitizers', () => {
      const customValidator = new InputValidator({
        customSanitizers: {
          'user.name': (value) => value.toUpperCase()
        }
      })
      
      const result = customValidator['sanitizeValue']({ user: { name: 'john' } })
      expect(result.user.name).toBe('JOHN')
    })
  })

  describe('Schema Validation', () => {
    const testSchema = z.object({
      name: z.string().min(1).max(100),
      age: z.number().int().min(0).max(150),
      email: z.string().email()
    })

    it('should validate valid data successfully', async () => {
      const validData = {
        name: 'John Doe',
        age: 30,
        email: 'john@example.com'
      }
      
      const result = await validator.validate(validData, testSchema)
      
      expect(result.success).toBe(true)
      expect(result.data).toEqual(validData)
      expect(result.errors).toBeUndefined()
    })

    it('should return validation errors for invalid data', async () => {
      const invalidData = {
        name: '',
        age: -5,
        email: 'invalid-email'
      }
      
      const result = await validator.validate(invalidData, testSchema)
      
      expect(result.success).toBe(false)
      expect(result.errors).toHaveLength(3)
      expect(result.errors?.[0].field).toBe('name')
      expect(result.errors?.[1].field).toBe('age')
      expect(result.errors?.[2].field).toBe('email')
    })

    it('should sanitize data before validation', async () => {
      const dirtyData = {
        name: '  John Doe  ',
        age: 30,
        email: '  JOHN@EXAMPLE.COM  '
      }
      
      const result = await validator.validate(dirtyData, testSchema, true)
      
      expect(result.success).toBe(true)
      expect(result.data?.name).toBe('John Doe')
      expect(result.data?.email).toBe('JOHN@EXAMPLE.COM')
    })

    it('should skip sanitization when disabled', async () => {
      const dirtyData = {
        name: '  John Doe  ',
        age: 30,
        email: '  john@example.com  '
      }
      
      const result = await validator.validate(dirtyData, testSchema, false)
      
      expect(result.success).toBe(false) // Should fail due to email validation
    })

    it('should run security scanning when enabled', async () => {
      const testData = { name: 'John', age: 30, email: 'john@example.com' }
      
      await validator.validate(testData, testSchema, true, 'trace-456')
      
      expect(mockSecurityScannerInstance.scanBatch).toHaveBeenCalledWith(testData, 'trace-456')
    })

    it('should block on security threats when configured', async () => {
      const blockingValidator = new InputValidator({ blockOnSecurityThreats: true })
      mockSecurityScannerInstance.scanBatch.mockResolvedValue({
        name: { threats: [{ type: 'xss', severity: 'high' }], blocked: true }
      })
      
      const result = await blockingValidator.validate(
        { name: 'malicious', age: 30, email: 'test@example.com' }, 
        testSchema
      )
      
      expect(result.success).toBe(false)
      expect(result.blocked).toBe(true)
      expect(result.errors?.[0].code).toBe('SECURITY_THREAT_BLOCKED')
      expect(result.securityThreats).toHaveLength(1)
    })

    it('should warn about threats but continue when not blocking', async () => {
      const warnValidator = new InputValidator({ blockOnSecurityThreats: false })
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()
      
      mockSecurityScannerInstance.scanBatch.mockResolvedValue({
        name: { threats: [{ type: 'suspicious', severity: 'low' }], blocked: false }
      })
      
      const result = await warnValidator.validate(
        { name: 'suspicious', age: 30, email: 'test@example.com' }, 
        testSchema,
        true,
        'trace-789'
      )
      
      expect(result.success).toBe(true)
      expect(result.securityThreats).toHaveLength(1)
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Security threats detected but not blocking'),
        expect.any(Array)
      )
      
      consoleSpy.mockRestore()
    })

    it('should use sanitized data from security scanner', async () => {
      mockSecurityScannerInstance.scanBatch.mockResolvedValue({
        name: { 
          threats: [], 
          blocked: false, 
          sanitized: { name: 'clean-name', age: 30, email: 'clean@example.com' }
        }
      })
      
      const result = await validator.validate(
        { name: 'dirty-name', age: 30, email: 'dirty@example.com' }, 
        testSchema
      )
      
      expect(result.success).toBe(true)
      expect(result.data?.name).toBe('clean-name')
      expect(result.data?.email).toBe('clean@example.com')
    })

    it('should handle validation processing errors', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
      mockSecurityScannerInstance.scanBatch.mockRejectedValue(new Error('Scanner failed'))
      
      const result = await validator.validate({ name: 'test' }, testSchema)
      
      expect(result.success).toBe(false)
      expect(result.errors?.[0].code).toBe('VALIDATION_ERROR')
      expect(consoleSpy).toHaveBeenCalled()
      
      consoleSpy.mockRestore()
    })
  })

  describe('File Validation', () => {
    it('should validate allowed file types', () => {
      const validFile = new File(['content'], 'test.jpg', { type: 'image/jpeg' })
      const result = validator.validateFile(validFile)
      
      expect(result.success).toBe(true)
      expect(result.data?.type).toBe('image/jpeg')
    })

    it('should reject disallowed file types', () => {
      const invalidFile = new File(['content'], 'test.exe', { type: 'application/x-executable' })
      const result = validator.validateFile(invalidFile)
      
      expect(result.success).toBe(false)
      expect(result.errors?.[0].code).toBe('INVALID_FILE_TYPE')
    })

    it('should reject files exceeding size limit', () => {
      const largeFile = new File(['x'.repeat(20 * 1024 * 1024)], 'large.jpg', { type: 'image/jpeg' })
      const result = validator.validateFile(largeFile)
      
      expect(result.success).toBe(false)
      expect(result.errors?.[0].code).toBe('FILE_TOO_LARGE')
    })

    it('should sanitize file names', () => {
      const badNameFile = new File(['content'], 'bad<script>.jpg', { type: 'image/jpeg' })
      const result = validator.validateFile(badNameFile)
      
      expect(result.success).toBe(false)
      expect(result.errors?.[0].code).toBe('INVALID_FILE_NAME')
    })

    it('should return sanitized file data for valid files', () => {
      const validFile = new File(['content'], 'test.jpg', { type: 'image/jpeg' })
      Object.defineProperty(validFile, 'size', { value: 1024 })
      
      const result = validator.validateFile(validFile)
      
      expect(result.success).toBe(true)
      expect(result.data).toEqual({
        name: 'test.jpg',
        type: 'image/jpeg',
        size: 1024
      })
    })
  })
})

describe('Common Validation Schemas', () => {
  it('should validate user IDs as UUIDs', () => {
    const validUuid = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
    const invalidUuid = 'not-a-uuid'
    
    expect(CommonSchemas.userId.safeParse(validUuid).success).toBe(true)
    expect(CommonSchemas.userId.safeParse(invalidUuid).success).toBe(false)
  })

  it('should validate tenant IDs with proper format', () => {
    const validTenant = 'tenant-123'
    const invalidTenant = 'tenant with spaces'
    
    expect(CommonSchemas.tenantId.safeParse(validTenant).success).toBe(true)
    expect(CommonSchemas.tenantId.safeParse(invalidTenant).success).toBe(false)
  })

  it('should validate email addresses', () => {
    const validEmail = 'user@example.com'
    const invalidEmail = 'not-an-email'
    
    expect(CommonSchemas.email.safeParse(validEmail).success).toBe(true)
    expect(CommonSchemas.email.safeParse(invalidEmail).success).toBe(false)
  })

  it('should validate complex passwords', () => {
    const validPassword = 'StrongP@ss123'
    const weakPassword = 'weak'
    
    expect(CommonSchemas.password.safeParse(validPassword).success).toBe(true)
    expect(CommonSchemas.password.safeParse(weakPassword).success).toBe(false)
  })

  it('should validate pagination parameters', () => {
    const validPagination = { page: 1, limit: 20 }
    const invalidPagination = { page: 0, limit: 200 }
    
    expect(CommonSchemas.pagination.safeParse(validPagination).success).toBe(true)
    expect(CommonSchemas.pagination.safeParse(invalidPagination).success).toBe(false)
  })

  it('should validate IP addresses', () => {
    const validIpv4 = '192.168.1.1'
    const validIpv6 = '2001:0db8:85a3:0000:0000:8a2e:0370:7334'
    const invalidIp = 'not-an-ip'
    
    expect(CommonSchemas.ipAddress.safeParse(validIpv4).success).toBe(true)
    expect(CommonSchemas.ipAddress.safeParse(validIpv6).success).toBe(true)
    expect(CommonSchemas.ipAddress.safeParse(invalidIp).success).toBe(false)
  })

  it('should validate file metadata', () => {
    const validMetadata = { name: 'test.jpg', type: 'image/jpeg', size: 1024 }
    const invalidMetadata = { name: '', type: 'image/jpeg', size: -1 }
    
    expect(CommonSchemas.fileMetadata.safeParse(validMetadata).success).toBe(true)
    expect(CommonSchemas.fileMetadata.safeParse(invalidMetadata).success).toBe(false)
  })
})

describe('withValidation middleware', () => {
  let mockHandler: jest.Mock
  let validationMiddleware: any

  beforeEach(() => {
    jest.clearAllMocks()
    mockTracing.generateTraceId.mockReturnValue('trace-middleware')
    
    mockHandler = jest.fn()
    
    const schema = z.object({
      name: z.string(),
      age: z.number()
    })
    
    validationMiddleware = withValidation(schema)(mockHandler)
  })

  it('should validate query parameters', async () => {
    mockHandler.mockResolvedValue(NextResponse.json({ success: true }))
    
    const request = new NextRequest('http://localhost:3000/api/test?name=John&age=30')
    await validationMiddleware(request)
    
    expect(mockHandler).toHaveBeenCalledWith(
      request,
      expect.objectContaining({ name: 'John', age: '30' })
    )
  })

  it('should validate JSON request body', async () => {
    mockHandler.mockResolvedValue(NextResponse.json({ success: true }))
    
    const requestBody = { name: 'John', age: 30 }
    const request = new NextRequest('http://localhost:3000/api/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody)
    })
    
    await validationMiddleware(request)
    
    expect(mockHandler).toHaveBeenCalledWith(
      request,
      expect.objectContaining(requestBody)
    )
  })

  it('should validate form data request body', async () => {
    mockHandler.mockResolvedValue(NextResponse.json({ success: true }))
    
    const formData = new FormData()
    formData.append('name', 'John')
    formData.append('age', '30')
    
    const request = new NextRequest('http://localhost:3000/api/test', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: formData
    })
    
    await validationMiddleware(request)
    
    expect(mockHandler).toHaveBeenCalledWith(
      request,
      expect.objectContaining({ name: 'John', age: '30' })
    )
  })

  it('should return 400 for invalid request body', async () => {
    const request = new NextRequest('http://localhost:3000/api/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'invalid json'
    })
    
    const response = await validationMiddleware(request)
    const responseData = await response.json()
    
    expect(response.status).toBe(400)
    expect(responseData.error.code).toBe('INVALID_REQUEST_BODY')
    expect(mockHandler).not.toHaveBeenCalled()
  })

  it('should return 400 for validation failures', async () => {
    const request = new NextRequest('http://localhost:3000/api/test?name=&age=invalid')
    
    const response = await validationMiddleware(request)
    const responseData = await response.json()
    
    expect(response.status).toBe(400)
    expect(responseData.error.code).toBe('VALIDATION_FAILED')
    expect(responseData.error.details).toHaveLength(2)
    expect(mockHandler).not.toHaveBeenCalled()
  })

  it('should return 403 for security threats when blocking', async () => {
    mockSecurityScannerInstance.scanBatch.mockResolvedValue({
      name: { threats: [{ type: 'xss' }], blocked: true }
    })
    
    const blockingMiddleware = withValidation(
      z.object({ name: z.string() }),
      { config: { blockOnSecurityThreats: true } }
    )(mockHandler)
    
    const request = new NextRequest('http://localhost:3000/api/test?name=malicious')
    const response = await blockingMiddleware(request)
    const responseData = await response.json()
    
    expect(response.status).toBe(403)
    expect(responseData.error.code).toBe('SECURITY_THREAT_BLOCKED')
    expect(mockHandler).not.toHaveBeenCalled()
  })

  it('should skip query validation when disabled', async () => {
    mockHandler.mockResolvedValue(NextResponse.json({ success: true }))
    
    const schema = z.object({ name: z.string() })
    const middleware = withValidation(schema, { validateQuery: false })(mockHandler)
    
    const request = new NextRequest('http://localhost:3000/api/test?name=John', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Jane' })
    })
    
    await middleware(request)
    
    expect(mockHandler).toHaveBeenCalledWith(
      request,
      expect.objectContaining({ name: 'Jane' })
    )
  })

  it('should skip body validation when disabled', async () => {
    mockHandler.mockResolvedValue(NextResponse.json({ success: true }))
    
    const schema = z.object({ name: z.string() })
    const middleware = withValidation(schema, { validateBody: false })(mockHandler)
    
    const request = new NextRequest('http://localhost:3000/api/test?name=John', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Jane' })
    })
    
    await middleware(request)
    
    expect(mockHandler).toHaveBeenCalledWith(
      request,
      expect.objectContaining({ name: 'John' })
    )
  })

  it('should handle middleware errors gracefully', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
    mockHandler.mockRejectedValue(new Error('Handler failed'))
    
    // Create a simple request that should validate successfully
    const request = new NextRequest('http://localhost:3000/api/test?name=John&age=30')
    
    // Since validation should succeed but handler fails, we expect a middleware error
    const response = await validationMiddleware(request)
    const responseData = await response.json()
    
    expect(response.status).toBe(500)
    expect(responseData.error.code).toBe('VALIDATION_MIDDLEWARE_ERROR')
    expect(consoleSpy).toHaveBeenCalled()
    
    consoleSpy.mockRestore()
  })

  it('should disable sanitization when requested', async () => {
    mockHandler.mockResolvedValue(NextResponse.json({ success: true }))
    
    const schema = z.object({ name: z.string() })
    const middleware = withValidation(schema, { sanitize: false })(mockHandler)
    
    const request = new NextRequest('http://localhost:3000/api/test?name=  John  ')
    await middleware(request)
    
    // Should not sanitize (trim) the name
    expect(mockHandler).toHaveBeenCalledWith(
      request,
      expect.objectContaining({ name: '  John  ' })
    )
  })
})

describe('Global validator instance', () => {
  it('should export a global validator instance', () => {
    expect(globalValidator).toBeInstanceOf(InputValidator)
  })

  it('should use default configuration', () => {
    expect(globalValidator['config'].sanitizeHtml).toBe(true)
    expect(globalValidator['config'].enableSecurityScanning).toBe(true)
  })
})