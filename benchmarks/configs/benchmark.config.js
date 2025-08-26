/**
 * Keyfront BFF Performance Benchmark Configuration
 * 
 * This configuration defines the performance testing parameters
 * and target metrics for the Keyfront BFF system.
 */

// K6-compatible configuration export
const config = {
  // Test Environment
  environment: {
    name: 'local',
    baseUrl: 'http://localhost:3000',
    keycloakUrl: 'http://localhost:8080',
    redisUrl: 'redis://localhost:6379',
  },

  // Performance Targets (based on ROADMAP requirements)
  targets: {
    authentication: {
      // p95 response time < 300ms for authentication
      p95ResponseTime: 300, // ms
      errorRate: 0.001, // 0.1%
      throughput: 100, // requests per second
    },
    apiProxy: {
      // p95 response time < 150ms for proxy
      p95ResponseTime: 150, // ms
      errorRate: 0.001, // 0.1%
      throughput: 1000, // requests per second
    },
    rateLimiting: {
      // Rate limiting accuracy
      accuracy: 0.95, // 95% accuracy
      responseTime: 50, // ms
      errorRate: 0.001, // 0.1%
    },
    session: {
      // Session management performance
      p95ResponseTime: 100, // ms
      errorRate: 0.001, // 0.1%
      throughput: 500, // requests per second
    },
  },

  // Load Testing Scenarios
  loadTests: {
    // Smoke Test - Basic functionality check
    smoke: {
      duration: '30s',
      vus: 5, // virtual users
      rps: 10, // requests per second
    },
    
    // Load Test - Normal expected load
    load: {
      duration: '5m',
      vus: 50,
      rps: 100,
    },
    
    // Stress Test - High load testing
    stress: {
      duration: '10m',
      vus: 200,
      rps: 500,
    },
    
    // Spike Test - Sudden traffic spikes
    spike: {
      duration: '2m',
      vus: 500,
      rps: 1000,
    },
    
    // Soak Test - Long duration testing
    soak: {
      duration: '30m',
      vus: 100,
      rps: 200,
    },
  },

  // Monitoring and Metrics
  monitoring: {
    // Prometheus metrics endpoint
    metricsEndpoint: '/api/metrics',
    
    // Custom metrics to track
    customMetrics: [
      'keyfront_http_requests_total',
      'keyfront_http_request_duration_seconds',
      'keyfront_session_operations_total',
      'keyfront_auth_operations_total',
      'keyfront_rate_limit_hits_total',
    ],
    
    // System metrics
    systemMetrics: [
      'process_cpu_seconds_total',
      'process_resident_memory_bytes',
      'nodejs_heap_size_total_bytes',
      'nodejs_heap_size_used_bytes',
    ],
  },

  // Test Data
  testData: {
    users: {
      // Test user credentials
      count: 100,
      usernamePrefix: 'testuser',
      password: 'TestPass123!',
    },
    
    tenants: {
      // Multi-tenant testing
      count: 10,
      tenantPrefix: 'tenant',
    },
    
    payloads: {
      // API payload sizes for testing
      small: 1024, // 1KB
      medium: 10240, // 10KB
      large: 102400, // 100KB
    },
  },

  // Test Scenarios
  scenarios: {
    // Authentication Flow Performance
    authFlow: {
      name: 'OIDC Authentication Flow',
      description: 'Complete OAuth authorization code + PKCE flow',
      endpoints: [
        'GET /api/auth/login',
        'GET /api/auth/callback',
        'POST /api/auth/logout',
      ],
      target: 'authentication',
    },

    // API Gateway Performance  
    apiGateway: {
      name: 'API Gateway Proxy',
      description: 'Backend API proxying through BFF',
      endpoints: [
        'GET /api/gateway/users',
        'POST /api/gateway/users',
        'PUT /api/gateway/users/:id',
        'DELETE /api/gateway/users/:id',
      ],
      target: 'apiProxy',
    },

    // Rate Limiting Performance
    rateLimiting: {
      name: 'Rate Limiting System',
      description: 'Rate limit enforcement accuracy and performance',
      endpoints: [
        'GET /api/me', // User rate limit
        'GET /api/gateway/public', // Global rate limit
      ],
      target: 'rateLimiting',
    },

    // Session Management Performance
    sessionManagement: {
      name: 'Session Operations',
      description: 'Session creation, validation, and cleanup',
      endpoints: [
        'GET /api/me',
        'POST /api/auth/refresh',
        'GET /api/health/ready',
      ],
      target: 'session',
    },

    // Security Features Performance
    security: {
      name: 'Security Middleware',
      description: 'CORS, CSRF, Security Headers, Input Validation',
      endpoints: [
        'OPTIONS /api/gateway/test', // CORS
        'POST /api/csrf', // CSRF
        'GET /api/security-scan', // Security Scanner
        'POST /api/validation-test', // Input Validation
      ],
    },
  },

  // Reporting Configuration
  reporting: {
    outputDir: './benchmarks/results',
    formats: ['json', 'html', 'csv'],
    includeGraphs: true,
    includeSummary: true,
    
    // Thresholds for pass/fail
    thresholds: {
      http_req_duration: ['p(95)<300'], // 95th percentile < 300ms
      http_req_failed: ['rate<0.01'], // Error rate < 1%
      http_reqs: ['rate>100'], // Throughput > 100 RPS
    },
  },

  // Infrastructure Settings
  infrastructure: {
    // Docker settings for consistent testing
    docker: {
      image: 'keyfront/bff:latest',
      memory: '512m',
      cpu: '1',
    },
    
    // Kubernetes settings
    kubernetes: {
      namespace: 'benchmark',
      replicas: 1,
      resources: {
        requests: { cpu: '500m', memory: '256Mi' },
        limits: { cpu: '1000m', memory: '512Mi' },
      },
    },
  },
};

// Export for k6
export default config;