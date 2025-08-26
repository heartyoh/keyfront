import { handler } from '../../app/api/me/route'
import { NextRequest } from 'next/server'
import { AuthenticatedRequest } from '../../middleware/session'
import { UserSession } from '../../types/auth'

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

// Helper function to create complete UserSession
function createCompleteUserSession(overrides: Partial<UserSession> = {}): UserSession {
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
    createdAt: 1640995200000,
    lastActivity: 1640995200000,
    ...overrides
  }
}

describe('API /me handler', () => {
  let mockRequest: AuthenticatedRequest

  beforeEach(() => {
    jest.clearAllMocks()
    mockRequest = new NextRequest('http://localhost:3000/api/me', {
      method: 'GET',
    }) as AuthenticatedRequest
  })

  describe('handler function', () => {
    it('should return user information when user is authenticated', async () => {
      // Set user on authenticated request
      mockRequest.user = createCompleteUserSession()

      const response = await handler(mockRequest)
      const responseData = await response.json()

      expect(response.status).toBe(200)
      expect(responseData.success).toBe(true)
      expect(responseData.data).toMatchObject({
        id: 'user123',
        sub: 'user123',
        tenantId: 'tenant1',
        email: 'test@example.com',
        name: 'Test User',
        roles: ['USER'],
        permissions: ['read:profile'],
        createdAt: 1640995200000,
        lastActivity: 1640995200000,
      })
      // Should not include sensitive fields
      expect(responseData.data).not.toHaveProperty('accessTokenRef')
      expect(responseData.data).not.toHaveProperty('refreshTokenRef')
    })

    it('should include all user fields in response', async () => {
      mockRequest.user = createCompleteUserSession({
        roles: ['USER', 'ADMIN'],
        permissions: ['read:profile', 'write:data'],
        lastActivity: 1640995300000,
      })

      const response = await handler(mockRequest)
      const responseData = await response.json()

      expect(response.status).toBe(200)
      expect(responseData.data).toHaveProperty('id')
      expect(responseData.data).toHaveProperty('sub')
      expect(responseData.data).toHaveProperty('tenantId')
      expect(responseData.data).toHaveProperty('email')
      expect(responseData.data).toHaveProperty('name')
      expect(responseData.data).toHaveProperty('roles')
      expect(responseData.data).toHaveProperty('permissions')
      expect(responseData.data).toHaveProperty('createdAt')
      expect(responseData.data).toHaveProperty('lastActivity')
      
      expect(responseData.data.roles).toEqual(['USER', 'ADMIN'])
      expect(responseData.data.permissions).toEqual(['read:profile', 'write:data'])
      expect(responseData.data.lastActivity).toBe(1640995300000)
    })

    it('should return error when user is not authenticated', async () => {
      // Request without user property (undefined)
      mockRequest.user = undefined

      const response = await handler(mockRequest)
      const responseData = await response.json()

      expect(response.status).toBe(401)
      expect(responseData.success).toBe(false)
      expect(responseData.error.code).toBe('UNAUTHORIZED')
      expect(responseData.error.message).toBe('User not authenticated')
    })

    it('should handle handler errors gracefully', async () => {
      // Create a user with getter that throws error
      const problematicUser: any = {
        ...createCompleteUserSession(),
        // Override email with getter that throws
        get email() {
          throw new Error('Database connection failed')
        }
      }
      
      mockRequest.user = problematicUser

      const response = await handler(mockRequest)
      const responseData = await response.json()

      expect(response.status).toBe(500)
      expect(responseData.success).toBe(false)
      expect(responseData.error.code).toBe('INTERNAL_ERROR')
      expect(responseData.error.message).toBe('Failed to retrieve user information')
    })
  })

  describe('Response Format Validation', () => {
    beforeEach(() => {
      mockRequest.user = createCompleteUserSession()
    })

    it('should return standardized success response format', async () => {
      const response = await handler(mockRequest)
      const responseData = await response.json()

      expect(responseData).toHaveProperty('success', true)
      expect(responseData).toHaveProperty('data')
      expect(typeof responseData.data).toBe('object')
    })

    it('should exclude sensitive data from response', async () => {
      const response = await handler(mockRequest)
      const responseData = await response.json()

      // Should not include sensitive fields like accessToken, refreshToken, etc.
      expect(responseData.data).not.toHaveProperty('accessToken')
      expect(responseData.data).not.toHaveProperty('refreshToken')
      expect(responseData.data).not.toHaveProperty('accessTokenRef')
      expect(responseData.data).not.toHaveProperty('refreshTokenRef')
    })
  })

  describe('Error Handling', () => {
    it('should return standardized error response format when unauthorized', async () => {
      mockRequest.user = undefined

      const response = await handler(mockRequest)
      const responseData = await response.json()

      expect(responseData).toHaveProperty('success', false)
      expect(responseData).toHaveProperty('error')
      expect(responseData.error).toHaveProperty('code')
      expect(responseData.error).toHaveProperty('message')
      expect(typeof responseData.error.code).toBe('string')
      expect(typeof responseData.error.message).toBe('string')
    })

    it('should handle various error conditions', async () => {
      // Test with null user
      mockRequest.user = null as any
      let response = await handler(mockRequest)
      let responseData = await response.json()
      expect(response.status).toBe(401)
      expect(responseData.error.code).toBe('UNAUTHORIZED')
    })
  })

  describe('Enhanced Validation', () => {
    it('should handle partial user data', async () => {
      mockRequest.user = createCompleteUserSession({
        email: undefined,
        name: undefined,
        permissions: [],
      })

      const response = await handler(mockRequest)
      const responseData = await response.json()

      expect(response.status).toBe(200)
      expect(responseData.success).toBe(true)
      expect(responseData.data.id).toBe('user123')
      expect(responseData.data.permissions).toEqual([])
      expect(responseData.data.email).toBeUndefined()
      expect(responseData.data.name).toBeUndefined()
    })

    it('should handle user with multiple roles', async () => {
      mockRequest.user = createCompleteUserSession({
        id: 'admin123',
        sub: 'admin123',
        email: 'admin@example.com',
        name: 'Admin User',
        roles: ['USER', 'ADMIN', 'SUPER_ADMIN'],
        permissions: ['read:all', 'write:all', 'admin:all'],
      })

      const response = await handler(mockRequest)
      const responseData = await response.json()

      expect(response.status).toBe(200)
      expect(responseData.data.roles).toHaveLength(3)
      expect(responseData.data.roles).toEqual(['USER', 'ADMIN', 'SUPER_ADMIN'])
      expect(responseData.data.permissions).toHaveLength(3)
    })

    it('should handle user with no permissions', async () => {
      mockRequest.user = createCompleteUserSession({
        id: 'restricted123',
        sub: 'restricted123',
        email: 'restricted@example.com',
        name: 'Restricted User',
        roles: ['GUEST'],
        permissions: [], // No permissions
      })

      const response = await handler(mockRequest)
      const responseData = await response.json()

      expect(response.status).toBe(200)
      expect(responseData.data.permissions).toEqual([])
      expect(responseData.data.roles).toEqual(['GUEST'])
    })

    it('should validate timestamp fields are present', async () => {
      mockRequest.user = createCompleteUserSession({
        createdAt: 1640995200000,
        lastActivity: 1640995300000,
      })

      const response = await handler(mockRequest)
      const responseData = await response.json()

      expect(response.status).toBe(200)
      expect(responseData.data.createdAt).toBe(1640995200000)
      expect(responseData.data.lastActivity).toBe(1640995300000)
      expect(typeof responseData.data.createdAt).toBe('number')
      expect(typeof responseData.data.lastActivity).toBe('number')
    })
  })
})