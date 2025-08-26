export interface TenantConfiguration {
  id: string;
  tenantId: string;
  name: string;
  
  // CORS 설정
  corsConfig: {
    origins: string[];
    methods: string[];
    allowedHeaders: string[];
    exposedHeaders: string[];
    credentials: boolean;
    maxAge: number;
  };
  
  // Rate Limiting 설정
  rateLimits: {
    perMinute: number;
    perHour: number;
    perDay: number;
    burst: number;
    whitelistIps: string[];
    blacklistIps: string[];
  };
  
  // 보안 설정
  security: {
    enableCsrfProtection: boolean;
    sessionTimeout: number;
    maxConcurrentSessions: number;
    requireSecureHeaders: boolean;
    enableStrictTransportSecurity: boolean;
  };
  
  // 기능 플래그
  features: {
    enableAuditLogging: boolean;
    enableMetricsCollection: boolean;
    enableWebSocketSupport: boolean;
    enableAdvancedAuth: boolean;
    enableCustomHeaders: boolean;
  };
  
  // API 프록시 설정
  proxyConfig: {
    baseUrl: string;
    timeout: number;
    retries: number;
    retryDelay: number;
    enableCircuitBreaker: boolean;
    circuitBreakerThreshold: number;
    customHeaders: Record<string, string>;
  };
  
  // 알림 설정
  notifications: {
    enableSecurityAlerts: boolean;
    enableErrorNotifications: boolean;
    enableUsageAlerts: boolean;
    webhookUrl?: string;
    emailRecipients: string[];
  };
  
  // 메타데이터
  metadata: {
    createdBy: string;
    createdAt: string;
    updatedBy: string;
    updatedAt: string;
    version: number;
    tags: string[];
    description?: string;
  };
  
  // 상태
  status: 'active' | 'inactive' | 'suspended';
}

export interface TenantConfigurationUpdate {
  name?: string;
  corsConfig?: Partial<TenantConfiguration['corsConfig']>;
  rateLimits?: Partial<TenantConfiguration['rateLimits']>;
  security?: Partial<TenantConfiguration['security']>;
  features?: Partial<TenantConfiguration['features']>;
  proxyConfig?: Partial<TenantConfiguration['proxyConfig']>;
  notifications?: Partial<TenantConfiguration['notifications']>;
  status?: TenantConfiguration['status'];
  tags?: string[];
  description?: string;
}

export interface TenantConfigurationQuery {
  page?: number;
  limit?: number;
  status?: TenantConfiguration['status'];
  search?: string;
  tags?: string[];
  sortBy?: 'name' | 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}

export interface TenantUsageStats {
  tenantId: string;
  period: {
    start: string;
    end: string;
  };
  requests: {
    total: number;
    successful: number;
    failed: number;
    rateLimited: number;
  };
  bandwidth: {
    inbound: number;
    outbound: number;
  };
  sessions: {
    total: number;
    active: number;
    peak: number;
  };
  errors: {
    total: number;
    byType: Record<string, number>;
  };
}