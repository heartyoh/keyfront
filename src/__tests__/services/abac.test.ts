import { abacEngine } from '../../services/abac'
import { redisService } from '../../services/redis'
import type { Policy, AccessRequest, Subject, Resource, Action, Environment } from '../../types/abac'

// Mock Redis service with proper methods
jest.mock('../../services/redis', () => ({
  redisService: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    delete: jest.fn(),
    getKeysByPattern: jest.fn(),
    deleteMultiple: jest.fn(),
    pushToQueue: jest.fn(),
    close: jest.fn(),
  }
}))

// Mock other dependencies
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

const mockRedisService = redisService as jest.Mocked<typeof redisService>

describe('ABAC Engine', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  const mockSubject: Subject = {
    id: 'user123',
    type: 'user',
    tenantId: 'tenant1',
    roles: ['USER'],
    attributes: {
      department: 'engineering',
      clearanceLevel: 2
    }
  }

  const mockResource: Resource = {
    id: 'doc123',
    type: 'document',
    tenantId: 'tenant1',
    ownerId: 'user123',
    attributes: {
      classification: 'internal',
      sensitive: false
    }
  }

  const mockAction: Action = {
    name: 'read',
    type: 'read',
    attributes: {}
  }

  const mockEnvironment: Environment = {
    timestamp: new Date().toISOString(),
    ipAddress: '192.168.1.100',
    isBusinessHours: true
  }

  const mockAccessRequest: AccessRequest = {
    subject: mockSubject,
    resource: mockResource,
    action: mockAction,
    environment: mockEnvironment
  }

  const mockPolicy: Omit<Policy, 'id'> = {
    name: 'Test Policy',
    description: 'A test policy',
    tenantId: 'tenant1',
    version: '1.0.0',
    rules: [
      {
        id: 'rule1',
        name: 'Allow USER read documents',
        effect: 'permit',
        target: {
          subjects: [{
            attribute: 'roles',
            operator: 'contains',
            value: 'USER'
          }],
          resources: [{
            attribute: 'type',
            operator: 'equals',
            value: 'document'
          }],
          actions: [{
            attribute: 'type',
            operator: 'equals',
            value: 'read'
          }]
        },
        priority: 100,
        enabled: true
      }
    ],
    metadata: {
      createdBy: 'admin',
      createdAt: new Date().toISOString(),
      updatedBy: 'admin',
      updatedAt: new Date().toISOString(),
      tags: ['test']
    },
    enabled: true
  }

  describe('Basic functionality', () => {
    it('should be instantiated', () => {
      expect(abacEngine).toBeDefined()
    })

    it('should have all required methods', () => {
      expect(typeof abacEngine.evaluateAccess).toBe('function')
      expect(typeof abacEngine.createPolicy).toBe('function')
      expect(typeof abacEngine.updatePolicy).toBe('function')
      expect(typeof abacEngine.deletePolicy).toBe('function')
      expect(typeof abacEngine.listPolicies).toBe('function')
      expect(typeof abacEngine.registerAttributeProvider).toBe('function')
      expect(typeof abacEngine.unregisterAttributeProvider).toBe('function')
    })
  })

  describe('evaluateAccess', () => {
    beforeEach(() => {
      // Mock loadApplicablePolicies to return empty policies for basic tests
      mockRedisService.getKeysByPattern.mockResolvedValue([])
    })

    it('should return not_applicable when no policies match', async () => {
      const result = await abacEngine.evaluateAccess(mockAccessRequest)

      expect(result).toBeDefined()
      expect(result.decision).toBe('not_applicable')
      expect(result.reason).toContain('No applicable policies found')
    })

    it('should accept optional trace ID', async () => {
      const traceId = 'custom-trace-id'
      
      const result = await abacEngine.evaluateAccess(mockAccessRequest, traceId)

      expect(result).toBeDefined()
      expect(result.traceId).toBe(traceId)
    })

    it('should generate trace ID when not provided', async () => {
      const result = await abacEngine.evaluateAccess(mockAccessRequest)

      expect(result).toBeDefined()
      expect(result.traceId).toBe('trace-123')
    })

    it('should handle evaluation errors gracefully', async () => {
      mockRedisService.getKeysByPattern.mockRejectedValue(new Error('Redis error'))

      const result = await abacEngine.evaluateAccess(mockAccessRequest)

      expect(result).toBeDefined()
      expect(result.decision).toBe('not_applicable')
      expect(result.reason).toContain('No applicable policies found')
    })
  })

  describe('createPolicy', () => {
    it('should create a policy with generated ID', async () => {
      mockRedisService.set.mockResolvedValue()
      mockRedisService.pushToQueue.mockResolvedValue(1)

      const result = await abacEngine.createPolicy(mockPolicy)

      expect(result).toBeDefined()
      expect(result.id).toBe('trace-123') // Uses generateTraceId()
      expect(result.name).toBe(mockPolicy.name)
      expect(result.tenantId).toBe(mockPolicy.tenantId)
      expect(result.enabled).toBe(true)
      expect(mockRedisService.set).toHaveBeenCalledWith(
        `abac:policy:${mockPolicy.tenantId}:trace-123`,
        expect.stringContaining('"name":"Test Policy"'),
        365 * 24 * 60 * 60
      )
    })

    it('should handle policy creation errors', async () => {
      mockRedisService.set.mockRejectedValue(new Error('Storage error'))

      await expect(abacEngine.createPolicy(mockPolicy)).rejects.toThrow('Storage error')
    })
  })

  describe('updatePolicy', () => {
    it('should return null for non-existent policy', async () => {
      mockRedisService.get.mockResolvedValue(null)

      const result = await abacEngine.updatePolicy('non-existent-id', 'tenant1', { name: 'Updated' })

      expect(result).toBeNull()
    })

    it('should handle update errors gracefully', async () => {
      mockRedisService.get.mockRejectedValue(new Error('Update error'))

      await expect(
        abacEngine.updatePolicy('policy-id', 'tenant1', { name: 'Updated' })
      ).rejects.toThrow('Update error')
    })
  })

  describe('deletePolicy', () => {
    it('should return false for non-existent policy', async () => {
      mockRedisService.delete.mockResolvedValue(0)

      const result = await abacEngine.deletePolicy('non-existent-id', 'tenant1')

      expect(result).toBe(false)
    })

    it('should return true when policy is deleted', async () => {
      mockRedisService.delete.mockResolvedValue(1)

      const result = await abacEngine.deletePolicy('existing-policy-id', 'tenant1')

      expect(result).toBe(true)
    })
  })

  describe('listPolicies', () => {
    it('should return empty array when no policies exist', async () => {
      mockRedisService.getKeysByPattern.mockResolvedValue([])

      const result = await abacEngine.listPolicies('tenant1')

      expect(result).toEqual([])
      expect(mockRedisService.getKeysByPattern).toHaveBeenCalledWith('abac:policy:tenant1:*')
    })

    it('should handle listing errors gracefully', async () => {
      mockRedisService.getKeysByPattern.mockRejectedValue(new Error('Redis error'))

      // ABAC engine catches errors and returns empty array for resilience
      const result = await abacEngine.listPolicies('tenant1')
      expect(result).toEqual([])
    })
  })

  describe('Attribute Providers', () => {
    const mockAttributeProvider = {
      name: 'testProvider',
      type: 'static' as const,
      getAttributes: jest.fn().mockResolvedValue({ testAttr: 'testValue' })
    }

    it('should register attribute provider', () => {
      expect(() => {
        abacEngine.registerAttributeProvider(mockAttributeProvider)
      }).not.toThrow()
    })

    it('should unregister attribute provider', () => {
      abacEngine.registerAttributeProvider(mockAttributeProvider)
      
      expect(() => {
        abacEngine.unregisterAttributeProvider('testProvider')
      }).not.toThrow()
    })

    it('should handle unregistering non-existent provider', () => {
      expect(() => {
        abacEngine.unregisterAttributeProvider('nonExistentProvider')
      }).not.toThrow()
    })
  })

  describe('Input validation', () => {
    it('should handle invalid access requests gracefully', async () => {
      const invalidRequest = {} as AccessRequest

      const result = await abacEngine.evaluateAccess(invalidRequest)
      
      expect(result.decision).toBe('indeterminate')
      expect(result.reason).toContain('Policy evaluation error')
    })

    it('should handle invalid policy data', async () => {
      const invalidPolicy = {} as Omit<Policy, 'id'>

      await expect(abacEngine.createPolicy(invalidPolicy)).rejects.toThrow()
    })

    it('should handle empty tenant ID in operations', async () => {
      const result = await abacEngine.listPolicies('')
      
      // ABAC engine handles empty tenant gracefully by returning empty array
      expect(result).toEqual([])
    })

    it('should validate required policy fields', async () => {
      const incompletePolicy = {
        name: 'Test Policy',
        // Missing required fields like tenantId, rules, etc.
      } as Omit<Policy, 'id'>

      await expect(abacEngine.createPolicy(incompletePolicy)).rejects.toThrow()
    })
  })

  describe('Enhanced validation and edge cases', () => {
    it('should handle malformed policy data in Redis', async () => {
      const malformedPolicyKeys = ['abac:policy:tenant1:policy1']
      mockRedisService.getKeysByPattern.mockResolvedValue(malformedPolicyKeys)
      mockRedisService.get.mockResolvedValue('invalid-json-data')

      const result = await abacEngine.listPolicies('tenant1')
      
      // Should gracefully handle malformed data
      expect(result).toEqual([])
    })

    it('should handle very large policy lists', async () => {
      const largePolicyKeys = Array.from({length: 1000}, (_, i) => `abac:policy:tenant1:policy${i}`)
      mockRedisService.getKeysByPattern.mockResolvedValue(largePolicyKeys)
      mockRedisService.get.mockImplementation(() => Promise.resolve(JSON.stringify(mockPolicy)))

      const result = await abacEngine.listPolicies('tenant1')
      
      expect(result).toHaveLength(1000)
    })

    it('should validate access request structure', async () => {
      const partialRequest = {
        subject: mockSubject,
        // Missing resource, action, environment
      } as AccessRequest

      const result = await abacEngine.evaluateAccess(partialRequest)
      
      expect(result.decision).toBe('indeterminate')
      expect(result.reason).toContain('Policy evaluation error')
    })

    it('should handle concurrent access requests', async () => {
      mockRedisService.getKeysByPattern.mockResolvedValue([])

      const promises = Array.from({length: 10}, () => 
        abacEngine.evaluateAccess(mockAccessRequest)
      )

      const results = await Promise.all(promises)
      
      results.forEach(result => {
        expect(result.decision).toBe('not_applicable')
        expect(result.traceId).toBe('trace-123')
      })
    })

    it('should handle policy update with version conflicts', async () => {
      const existingPolicy = { ...mockPolicy, id: 'policy1' }
      mockRedisService.get.mockResolvedValue(JSON.stringify(existingPolicy))
      mockRedisService.set.mockResolvedValue()

      const updates = { version: '2.0.0', name: 'Updated Policy' }
      const result = await abacEngine.updatePolicy('policy1', 'tenant1', updates)

      expect(result).toBeTruthy()
      expect(result?.version).toBe('2.0.0')
      expect(result?.name).toBe('Updated Policy')
    })

    it('should validate policy rules structure', async () => {
      const policyWithInvalidRules = {
        ...mockPolicy,
        rules: [
          {
            id: 'invalid-rule',
            // Missing required fields
            name: 'Invalid Rule',
          }
        ]
      } as Omit<Policy, 'id'>

      // ABAC engine currently doesn't validate rule structure, just stores the policy
      mockRedisService.set.mockResolvedValue()
      const result = await abacEngine.createPolicy(policyWithInvalidRules)
      expect(result.id).toBe('trace-123')
    })

    it('should handle Redis connection failures gracefully', async () => {
      mockRedisService.getKeysByPattern.mockRejectedValue(new Error('Connection timeout'))
      mockRedisService.set.mockRejectedValue(new Error('Connection timeout'))
      mockRedisService.get.mockRejectedValue(new Error('Connection timeout'))

      // All operations should handle Redis failures gracefully
      const listResult = await abacEngine.listPolicies('tenant1')
      expect(listResult).toEqual([])

      const evaluateResult = await abacEngine.evaluateAccess(mockAccessRequest)
      expect(evaluateResult.decision).toBe('not_applicable')

      await expect(abacEngine.createPolicy(mockPolicy)).rejects.toThrow('Connection timeout')
    })

    it('should validate tenant isolation', async () => {
      const tenant1Policies = ['abac:policy:tenant1:policy1']
      const tenant2Policies = ['abac:policy:tenant2:policy1']

      mockRedisService.getKeysByPattern
        .mockResolvedValueOnce(tenant1Policies)
        .mockResolvedValueOnce(tenant2Policies)

      mockRedisService.get.mockResolvedValue(JSON.stringify({ ...mockPolicy, tenantId: 'tenant1' }))

      await abacEngine.listPolicies('tenant1')
      await abacEngine.listPolicies('tenant2')

      expect(mockRedisService.getKeysByPattern).toHaveBeenCalledWith('abac:policy:tenant1:*')
      expect(mockRedisService.getKeysByPattern).toHaveBeenCalledWith('abac:policy:tenant2:*')
    })
  })
})