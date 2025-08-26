export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  traceId?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface AuditLog {
  id: string;
  timestamp: Date;
  tenantId: string;
  userId: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  result: 'allow' | 'deny' | 'error';
  reason?: string;
  metadata?: Record<string, any>;
  traceId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface RateLimitInfo {
  key: string;
  current: number;
  limit: number;
  resetTime: number;
  remaining: number;
}

export interface TenantConfig {
  tenantId: string;
  name: string;
  plan: 'basic' | 'pro' | 'enterprise';
  allowedOrigins: string[];
  maxRpm: number;
  branding?: {
    logo?: string;
    primaryColor?: string;
    companyName?: string;
  };
  features: {
    abac: boolean;
    auditLogging: boolean;
    rateLimiting: boolean;
    customRoles: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface FeatureFlag {
  key: string;
  tenantId: string;
  enabled: boolean;
  rule?: Record<string, any>;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebSocketAuditLog extends AuditLog {
  connectionId: string;
  event: 'connect' | 'disconnect' | 'message' | 'subscribe' | 'unsubscribe' | 'proxy_error';
  messageType?: string;
  targetEndpoint?: string;
  messageSize?: number;
  connectionDuration?: number;
}
