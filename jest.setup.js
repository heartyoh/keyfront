import 'jest-extended'

// Mock environment variables for testing
process.env.NODE_ENV = 'test'
process.env.KC_ISSUER_URL = 'https://keycloak.test/realms/test'
process.env.KC_CLIENT_ID = 'test-client'
process.env.KC_CLIENT_SECRET = 'test-secret'
process.env.KC_REDIRECT_URI = 'http://localhost:3000/api/auth/callback'
process.env.SESSION_SECRET = 'test-session-secret-32-characters-long'
process.env.SESSION_COOKIE_NAME = 'test.sid'
process.env.REDIS_URL = 'redis://localhost:6379'

// Mock Redis for tests
jest.mock('ioredis', () => {
  const mockRedis = {
    get: jest.fn(() => Promise.resolve(null)),
    set: jest.fn(() => Promise.resolve('OK')),
    setex: jest.fn(() => Promise.resolve('OK')),
    del: jest.fn(() => Promise.resolve(1)),
    expire: jest.fn(() => Promise.resolve(1)),
    exists: jest.fn(() => Promise.resolve(0)),
    keys: jest.fn(() => Promise.resolve([])),
    scan: jest.fn(() => Promise.resolve(['0', []])),
    hget: jest.fn(() => Promise.resolve(null)),
    hset: jest.fn(() => Promise.resolve(1)),
    hdel: jest.fn(() => Promise.resolve(1)),
    hgetall: jest.fn(() => Promise.resolve({})),
    lpush: jest.fn(() => Promise.resolve(1)),
    lrange: jest.fn(() => Promise.resolve([])),
    rpop: jest.fn(() => Promise.resolve(null)),
    llen: jest.fn(() => Promise.resolve(0)),
    ltrim: jest.fn(() => Promise.resolve('OK')),
    incr: jest.fn(() => Promise.resolve(1)),
    decr: jest.fn(() => Promise.resolve(0)),
    pipeline: jest.fn(() => ({
      get: jest.fn().mockReturnThis(),
      incr: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn(() => Promise.resolve([[null, null], [null, 1], [null, 1]])),
    })),
    multi: jest.fn().mockReturnThis(),
    exec: jest.fn(() => Promise.resolve([])),
    disconnect: jest.fn(() => Promise.resolve()),
    quit: jest.fn(() => Promise.resolve()),
    on: jest.fn(),
    ping: jest.fn(() => Promise.resolve('PONG')),
    status: 'ready',
  }

  const MockRedisClass = jest.fn(() => mockRedis)
  MockRedisClass.prototype = mockRedis
  
  return MockRedisClass
})

// Mock external services to prevent real connections during tests
jest.mock('@/services/keycloak', () => ({
  keycloakClient: {
    issuer: { metadata: { issuer: 'https://test.keycloak' } },
  },
}))

// Mock metrics collection to prevent timers in tests
jest.mock('@/lib/metrics', () => ({
  MetricsCollector: class MockMetricsCollector {
    constructor() {}
    increment() {}
    decrement() {}
    setGauge() {}
    recordHistogram() {}
    startTimer() { return { end: () => {} } }
    collectSystemMetrics() {}
  },
  metricsCollector: {
    increment: jest.fn(),
    decrement: jest.fn(),
    setGauge: jest.fn(),
    recordHistogram: jest.fn(),
    startTimer: jest.fn(() => ({ end: jest.fn() })),
  },
}))

// Mock audit logger to prevent Redis calls
jest.mock('@/lib/audit', () => ({
  auditLogger: {
    log: jest.fn(() => Promise.resolve()),
  },
  auditEvents: {
    login: jest.fn(() => Promise.resolve()),
    logout: jest.fn(() => Promise.resolve()),
    rateLimitHit: jest.fn(() => Promise.resolve()),
    securityThreat: jest.fn(() => Promise.resolve()),
  },
}))

// Only mock Request if it doesn't exist (avoid NextRequest conflicts)
if (typeof global.Request === 'undefined') {
  global.Request = class MockRequest {
    constructor(url, init = {}) {
      this.url = url
      this.method = init.method || 'GET'
      this.headers = new Map(Object.entries(init.headers || {}))
      this.body = init.body
    }
    
    json() {
      return Promise.resolve(JSON.parse(this.body || '{}'))
    }
  }
}

global.Response = class MockResponse {
  constructor(body, init = {}) {
    this.body = body
    this.status = init.status || 200
    this.statusText = init.statusText || 'OK'
    this.headers = new Map(Object.entries(init.headers || {}))
    this.ok = this.status >= 200 && this.status < 300
  }
  
  static json(data, init) {
    return new Response(JSON.stringify(data), {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {})
      }
    })
  }
  
  json() {
    return Promise.resolve(JSON.parse(this.body || '{}'))
  }
  
  text() {
    return Promise.resolve(this.body || '')
  }
}

// Global test helpers
global.createMockSession = (overrides = {}) => ({
  sessionId: 'test-session-id',
  userId: 'test-user-id',
  tenantId: 'test-tenant',
  roles: ['USER'],
  accessToken: 'test-access-token',
  refreshToken: 'test-refresh-token',
  tokenExpiry: Date.now() + 3600000, // 1 hour from now
  ...overrides
})

global.createMockRequest = (overrides = {}) => ({
  method: 'GET',
  url: 'http://localhost:3000/test',
  headers: new Map(),
  ...overrides
})