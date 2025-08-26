import { RedisService } from '../../services/redis'
import type { UserSession } from '../../types/auth'
import Redis from 'ioredis'

// Mock Redis
jest.mock('ioredis')
const mockRedis = Redis as jest.MockedClass<typeof Redis>

describe('RedisService', () => {
  let mockRedisInstance: jest.Mocked<Redis>
  let redisService: RedisService

  beforeEach(() => {
    jest.clearAllMocks()
    
    // Mock Date.now for consistent rate limit key generation
    jest.spyOn(Date, 'now').mockReturnValue(1234567890000)
    
    mockRedisInstance = {
      setex: jest.fn(),
      set: jest.fn(),
      get: jest.fn(),
      del: jest.fn(),
      expire: jest.fn(),
      exists: jest.fn(),
      incr: jest.fn(),
      on: jest.fn(),
      disconnect: jest.fn(),
      ping: jest.fn(),
      keys: jest.fn(),
      lpush: jest.fn(),
      lrange: jest.fn(),
      rpop: jest.fn(),
      llen: jest.fn(),
      ltrim: jest.fn(),
      pipeline: jest.fn(),
      quit: jest.fn(),
    } as any

    mockRedis.mockImplementation(() => mockRedisInstance)
    redisService = new RedisService()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  // Mock session data for testing
  const mockSession: UserSession = {
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
  }

  describe('Session Management', () => {

    describe('setSession', () => {
      it('should store a session with TTL', async () => {
        const sessionId = 'test-session'
        const ttl = 3600
        mockRedisInstance.setex.mockResolvedValue('OK')

        await redisService.setSession(sessionId, mockSession, ttl)

        expect(mockRedisInstance.setex).toHaveBeenCalledWith(
          'sess:test-session',
          ttl,
          JSON.stringify(mockSession)
        )
      })

      it('should use default TTL when not provided', async () => {
        const sessionId = 'test-session'
        mockRedisInstance.setex.mockResolvedValue('OK')

        await redisService.setSession(sessionId, mockSession)

        expect(mockRedisInstance.setex).toHaveBeenCalledWith(
          'sess:test-session',
          3600,
          JSON.stringify(mockSession)
        )
      })
    })

    describe('getSession', () => {
      it('should retrieve and parse a session', async () => {
        const sessionId = 'test-session'
        mockRedisInstance.get.mockResolvedValue(JSON.stringify(mockSession))

        const result = await redisService.getSession(sessionId)

        expect(mockRedisInstance.get).toHaveBeenCalledWith('sess:test-session')
        expect(result).toMatchObject({
          id: mockSession.id,
          sub: mockSession.sub,
          tenantId: mockSession.tenantId,
          roles: mockSession.roles,
        })
      })

      it('should return null when session does not exist', async () => {
        const sessionId = 'non-existent-session'
        mockRedisInstance.get.mockResolvedValue(null)

        const result = await redisService.getSession(sessionId)

        expect(result).toBeNull()
      })

      it('should handle corrupted session data', async () => {
        const sessionId = 'corrupted-session'
        mockRedisInstance.get.mockResolvedValue('invalid-json')

        const result = await redisService.getSession(sessionId)

        expect(result).toBeNull()
      })
    })

    describe('deleteSession', () => {
      it('should delete a session', async () => {
        const sessionId = 'test-session'
        mockRedisInstance.del.mockResolvedValue(1)

        await redisService.deleteSession(sessionId)

        expect(mockRedisInstance.del).toHaveBeenCalledWith('sess:test-session')
      })
    })

    describe('updateSessionActivity', () => {
      it('should update session last activity timestamp', async () => {
        const sessionId = 'test-session'
        const existingSession = { ...mockSession }
        
        mockRedisInstance.get.mockResolvedValue(JSON.stringify(existingSession))
        mockRedisInstance.setex.mockResolvedValue('OK')

        await redisService.updateSessionActivity(sessionId)

        expect(mockRedisInstance.get).toHaveBeenCalledWith('sess:test-session')
        expect(mockRedisInstance.setex).toHaveBeenCalledWith(
          'sess:test-session',
          3600,
          expect.stringContaining('"lastActivity":1234567890000')
        )
      })

      it('should do nothing when session does not exist', async () => {
        const sessionId = 'non-existent-session'
        mockRedisInstance.get.mockResolvedValue(null)

        await redisService.updateSessionActivity(sessionId)

        expect(mockRedisInstance.setex).not.toHaveBeenCalled()
      })
    })
  })

  describe('Rate Limiting', () => {
    describe('incrementRateLimit', () => {
      it('should increment rate limit counter with time-based key', async () => {
        const key = 'user123'
        const windowMs = 60000 // 1 minute
        mockRedisInstance.incr.mockResolvedValue(1)
        mockRedisInstance.expire.mockResolvedValue(1)

        const result = await redisService.incrementRateLimit(key, windowMs)

        // Expected key includes timestamp window: ratelimit:user123:20571
        const expectedKey = `ratelimit:user123:${Math.floor(Date.now() / windowMs)}`
        expect(mockRedisInstance.incr).toHaveBeenCalledWith(expectedKey)
        expect(mockRedisInstance.expire).toHaveBeenCalledWith(expectedKey, 60)
        expect(result).toBe(1)
      })
    })

    describe('getRateLimit', () => {
      it('should get current rate limit count with time-based key', async () => {
        const key = 'user123'
        const windowMs = 60000
        mockRedisInstance.get.mockResolvedValue('5')

        const result = await redisService.getRateLimit(key, windowMs)

        const expectedKey = `ratelimit:user123:${Math.floor(Date.now() / windowMs)}`
        expect(mockRedisInstance.get).toHaveBeenCalledWith(expectedKey)
        expect(result).toBe(5)
      })

      it('should return 0 when no rate limit exists', async () => {
        const key = 'user123'
        const windowMs = 60000
        mockRedisInstance.get.mockResolvedValue(null)

        const result = await redisService.getRateLimit(key, windowMs)

        expect(result).toBe(0)
      })
    })
  })

  describe('CSRF Token Management', () => {
    describe('setCSRFToken', () => {
      it('should store CSRF token', async () => {
        const sessionId = 'session123'
        const token = 'csrf-token'
        const ttl = 1800
        mockRedisInstance.setex.mockResolvedValue('OK')

        await redisService.setCSRFToken(sessionId, token, ttl)

        expect(mockRedisInstance.setex).toHaveBeenCalledWith(
          'csrf:session123',
          ttl,
          token
        )
      })
    })

    describe('getCSRFToken', () => {
      it('should retrieve CSRF token', async () => {
        const sessionId = 'session123'
        const token = 'csrf-token'
        mockRedisInstance.get.mockResolvedValue(token)

        const result = await redisService.getCSRFToken(sessionId)

        expect(mockRedisInstance.get).toHaveBeenCalledWith('csrf:session123')
        expect(result).toBe(token)
      })
    })

    describe('validateCSRFToken', () => {
      it('should validate correct CSRF token', async () => {
        const sessionId = 'session123'
        const token = 'csrf-token'
        mockRedisInstance.get.mockResolvedValue(token)

        const result = await redisService.validateCSRFToken(sessionId, token)

        expect(result).toBe(true)
      })

      it('should reject invalid CSRF token', async () => {
        const sessionId = 'session123'
        const token = 'csrf-token'
        const wrongToken = 'wrong-token'
        mockRedisInstance.get.mockResolvedValue(token)

        const result = await redisService.validateCSRFToken(sessionId, wrongToken)

        expect(result).toBe(false)
      })
    })
  })

  describe('OAuth State Management', () => {
    describe('setOAuthState', () => {
      it('should store OAuth state', async () => {
        const state = 'oauth-state'
        const data = { redirectUrl: '/dashboard', tenantId: 'tenant1' }
        const ttl = 600
        mockRedisInstance.setex.mockResolvedValue('OK')

        await redisService.setOAuthState(state, data, ttl)

        expect(mockRedisInstance.setex).toHaveBeenCalledWith(
          'oauth:state:oauth-state',
          ttl,
          JSON.stringify(data)
        )
      })
    })

    describe('getOAuthState', () => {
      it('should retrieve and parse OAuth state', async () => {
        const state = 'oauth-state'
        const data = { redirectUrl: '/dashboard', tenantId: 'tenant1' }
        mockRedisInstance.get.mockResolvedValue(JSON.stringify(data))

        const result = await redisService.getOAuthState(state)

        expect(mockRedisInstance.get).toHaveBeenCalledWith('oauth:state:oauth-state')
        expect(result).toEqual(data)
      })

      it('should return null for invalid OAuth state data', async () => {
        const state = 'oauth-state'
        mockRedisInstance.get.mockResolvedValue('invalid-json')

        const result = await redisService.getOAuthState(state)

        expect(result).toBeNull()
      })
    })

    describe('deleteOAuthState', () => {
      it('should delete OAuth state', async () => {
        const state = 'oauth-state'
        mockRedisInstance.del.mockResolvedValue(1)

        await redisService.deleteOAuthState(state)

        expect(mockRedisInstance.del).toHaveBeenCalledWith('oauth:state:oauth-state')
      })
    })
  })

  describe('Health Check', () => {
    describe('ping', () => {
      it('should return true when Redis responds with PONG', async () => {
        mockRedisInstance.ping.mockResolvedValue('PONG')

        const result = await redisService.ping()

        expect(result).toBe(true)
        expect(mockRedisInstance.ping).toHaveBeenCalled()
      })

      it('should return false when Redis ping fails', async () => {
        mockRedisInstance.ping.mockRejectedValue(new Error('Connection failed'))

        const result = await redisService.ping()

        expect(result).toBe(false)
      })
    })
  })

  describe('Session Cleanup', () => {
    describe('cleanupExpiredSessions', () => {
      it('should delete expired sessions and return count', async () => {
        const expiredSession = { ...mockSession, expiresAt: Date.now() - 1000 }
        const validSession = { ...mockSession, expiresAt: Date.now() + 10000 }
        
        mockRedisInstance.keys.mockResolvedValue(['sess:expired', 'sess:valid'])
        mockRedisInstance.get
          .mockResolvedValueOnce(JSON.stringify(expiredSession))
          .mockResolvedValueOnce(JSON.stringify(validSession))
        mockRedisInstance.del.mockResolvedValue(1)

        const result = await redisService.cleanupExpiredSessions()

        expect(mockRedisInstance.keys).toHaveBeenCalledWith('sess:*')
        expect(mockRedisInstance.del).toHaveBeenCalledWith('sess:expired')
        expect(mockRedisInstance.del).toHaveBeenCalledTimes(1)
        expect(result).toBe(1)
      })

      it('should return 0 when no sessions are expired', async () => {
        const validSession = { ...mockSession, expiresAt: Date.now() + 10000 }
        
        mockRedisInstance.keys.mockResolvedValue(['sess:valid'])
        mockRedisInstance.get.mockResolvedValue(JSON.stringify(validSession))

        const result = await redisService.cleanupExpiredSessions()

        expect(result).toBe(0)
        expect(mockRedisInstance.del).not.toHaveBeenCalled()
      })
    })
  })

  describe('Queue Operations', () => {
    describe('pushToQueue', () => {
      it('should push items to queue and return count', async () => {
        const queueKey = 'audit-queue'
        const items = ['item1', 'item2', 'item3']
        mockRedisInstance.lpush.mockResolvedValue(3)

        const result = await redisService.pushToQueue(queueKey, items)

        expect(mockRedisInstance.lpush).toHaveBeenCalledWith(queueKey, ...items)
        expect(result).toBe(3)
      })

      it('should return 0 when no items provided', async () => {
        const queueKey = 'audit-queue'
        const items: string[] = []

        const result = await redisService.pushToQueue(queueKey, items)

        expect(result).toBe(0)
        expect(mockRedisInstance.lpush).not.toHaveBeenCalled()
      })
    })

    describe('getFromQueue', () => {
      it('should retrieve items from queue', async () => {
        const queueKey = 'audit-queue'
        const items = ['item1', 'item2']
        mockRedisInstance.lrange.mockResolvedValue(items)

        const result = await redisService.getFromQueue(queueKey, 2)

        expect(mockRedisInstance.lrange).toHaveBeenCalledWith(queueKey, 0, 1)
        expect(result).toEqual(items)
      })

      it('should use default count of 100', async () => {
        const queueKey = 'audit-queue'
        mockRedisInstance.lrange.mockResolvedValue([])

        await redisService.getFromQueue(queueKey)

        expect(mockRedisInstance.lrange).toHaveBeenCalledWith(queueKey, 0, 99)
      })
    })

    describe('popFromQueue', () => {
      it('should pop item from queue', async () => {
        const queueKey = 'audit-queue'
        const item = 'item1'
        mockRedisInstance.rpop.mockResolvedValue(item)

        const result = await redisService.popFromQueue(queueKey)

        expect(mockRedisInstance.rpop).toHaveBeenCalledWith(queueKey)
        expect(result).toBe(item)
      })

      it('should return null when queue is empty', async () => {
        const queueKey = 'audit-queue'
        mockRedisInstance.rpop.mockResolvedValue(null)

        const result = await redisService.popFromQueue(queueKey)

        expect(result).toBeNull()
      })
    })

    describe('getQueueLength', () => {
      it('should return queue length', async () => {
        const queueKey = 'audit-queue'
        mockRedisInstance.llen.mockResolvedValue(5)

        const result = await redisService.getQueueLength(queueKey)

        expect(mockRedisInstance.llen).toHaveBeenCalledWith(queueKey)
        expect(result).toBe(5)
      })
    })

    describe('trimQueue', () => {
      it('should trim queue to max length', async () => {
        const queueKey = 'audit-queue'
        const maxLength = 100
        mockRedisInstance.ltrim.mockResolvedValue('OK')

        await redisService.trimQueue(queueKey, maxLength)

        expect(mockRedisInstance.ltrim).toHaveBeenCalledWith(queueKey, 0, 99)
      })
    })
  })

  describe('Pipeline Operations', () => {
    describe('pipeline', () => {
      it('should return redis pipeline', () => {
        const mockPipeline = { exec: jest.fn() } as any
        mockRedisInstance.pipeline.mockReturnValue(mockPipeline)

        const result = redisService.pipeline()

        expect(mockRedisInstance.pipeline).toHaveBeenCalled()
        expect(result).toBe(mockPipeline)
      })
    })

    describe('multi', () => {
      it('should execute multiple commands atomically', async () => {
        const mockPipeline = {
          setex: jest.fn(),
          del: jest.fn(),
          exec: jest.fn().mockResolvedValue([['OK'], [1]])
        } as any
        mockRedisInstance.pipeline.mockReturnValue(mockPipeline)

        const commands = [
          { command: 'setex', args: ['key1', 60, 'value1'] },
          { command: 'del', args: ['key2'] }
        ]

        const result = await redisService.multi(commands)

        expect(mockRedisInstance.pipeline).toHaveBeenCalled()
        expect(mockPipeline.setex).toHaveBeenCalledWith('key1', 60, 'value1')
        expect(mockPipeline.del).toHaveBeenCalledWith('key2')
        expect(mockPipeline.exec).toHaveBeenCalled()
        expect(result).toEqual([['OK'], [1]])
      })
    })
  })

  describe('Key Management', () => {
    describe('getKeysByPattern', () => {
      it('should return keys matching pattern', async () => {
        const pattern = 'sess:*'
        const keys = ['sess:user1', 'sess:user2']
        mockRedisInstance.keys.mockResolvedValue(keys)

        const result = await redisService.getKeysByPattern(pattern)

        expect(mockRedisInstance.keys).toHaveBeenCalledWith(pattern)
        expect(result).toEqual(keys)
      })
    })

    describe('deleteMultiple', () => {
      it('should delete multiple keys and return count', async () => {
        const keys = ['key1', 'key2', 'key3']
        mockRedisInstance.del.mockResolvedValue(3)

        const result = await redisService.deleteMultiple(keys)

        expect(mockRedisInstance.del).toHaveBeenCalledWith(...keys)
        expect(result).toBe(3)
      })

      it('should return 0 when no keys provided', async () => {
        const keys: string[] = []

        const result = await redisService.deleteMultiple(keys)

        expect(result).toBe(0)
        expect(mockRedisInstance.del).not.toHaveBeenCalled()
      })
    })
  })

  describe('Generic Redis Operations', () => {
    describe('get', () => {
      it('should get value by key', async () => {
        const key = 'test-key'
        const value = 'test-value'
        mockRedisInstance.get.mockResolvedValue(value)

        const result = await redisService.get(key)

        expect(mockRedisInstance.get).toHaveBeenCalledWith(key)
        expect(result).toBe(value)
      })

      it('should return null when key does not exist', async () => {
        const key = 'non-existent-key'
        mockRedisInstance.get.mockResolvedValue(null)

        const result = await redisService.get(key)

        expect(result).toBeNull()
      })
    })

    describe('set', () => {
      it('should set value with TTL', async () => {
        const key = 'test-key'
        const value = 'test-value'
        const ttl = 3600
        mockRedisInstance.setex.mockResolvedValue('OK')

        await redisService.set(key, value, ttl)

        expect(mockRedisInstance.setex).toHaveBeenCalledWith(key, ttl, value)
      })

      it('should set value without TTL', async () => {
        const key = 'test-key'
        const value = 'test-value'
        mockRedisInstance.set.mockResolvedValue('OK')

        await redisService.set(key, value)

        expect(mockRedisInstance.set).toHaveBeenCalledWith(key, value)
      })
    })

    describe('delete', () => {
      it('should delete key and return count', async () => {
        const key = 'test-key'
        mockRedisInstance.del.mockResolvedValue(1)

        const result = await redisService.delete(key)

        expect(mockRedisInstance.del).toHaveBeenCalledWith(key)
        expect(result).toBe(1)
      })

      it('should return 0 when key does not exist', async () => {
        const key = 'non-existent-key'
        mockRedisInstance.del.mockResolvedValue(0)

        const result = await redisService.delete(key)

        expect(result).toBe(0)
      })
    })
  })

  describe('Connection Management', () => {
    it('should set up error and connect event listeners', () => {
      expect(mockRedisInstance.on).toHaveBeenCalledWith('error', expect.any(Function))
      expect(mockRedisInstance.on).toHaveBeenCalledWith('connect', expect.any(Function))
    })

    describe('close', () => {
      it('should close Redis connection', async () => {
        mockRedisInstance.quit.mockResolvedValue('OK')

        await redisService.close()

        expect(mockRedisInstance.quit).toHaveBeenCalled()
      })
    })
  })
})