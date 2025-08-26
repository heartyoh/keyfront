export interface BackchannelLogoutToken {
  iss: string; // Issuer
  aud: string | string[]; // Audience (client_id or array of client_ids)
  iat: number; // Issued at
  jti: string; // JWT ID
  
  // Required claims
  events: {
    'http://schemas.openid.net/secevent/risc/event-type/sessions-revoked'?: {};
    'http://schemas.openid.net/secevent/oauth/event-type/token-revoked'?: {};
  };
  
  // Optional claims - at least one of sub or sid must be present
  sub?: string; // Subject identifier
  sid?: string; // Session identifier
  
  // Additional claims
  exp?: number; // Expiration time
  nonce?: string; // Nonce from authentication request
}

export interface BackchannelLogoutRequest {
  logout_token: string; // JWT logout token
}

export interface LogoutSession {
  sessionId: string;
  userId: string;
  tenantId: string;
  
  // Session metadata
  createdAt: string;
  lastActivity: string;
  expiresAt: number;
  
  // Client information
  clientId?: string;
  
  // Logout tracking
  logoutInitiated?: boolean;
  logoutRequestedAt?: string;
  logoutCompletedAt?: string;
  
  // Related sessions (for SSO)
  relatedSessions?: string[];
  
  // Device/context information
  deviceInfo?: {
    userAgent?: string;
    ipAddress?: string;
    deviceFingerprint?: string;
  };
}

export interface ClientRegistration {
  client_id: string;
  client_name: string;
  tenantId: string;
  
  // Logout configuration
  backchannel_logout_uri?: string;
  backchannel_logout_session_required?: boolean;
  
  // Client authentication for logout
  client_secret?: string;
  client_assertion_type?: string;
  
  // Notification preferences
  logout_notification_enabled: boolean;
  logout_timeout_seconds: number; // How long to wait for logout confirmation
  
  // Security settings
  trusted_client: boolean;
  require_logout_confirmation: boolean;
  
  metadata: {
    createdBy: string;
    createdAt: string;
    updatedAt: string;
  };
  
  enabled: boolean;
}

export interface LogoutEvent {
  id: string;
  timestamp: string;
  traceId: string;
  tenantId: string;
  
  // Event details
  event_type: 'session_terminated' | 'token_revoked' | 'user_logout' | 'admin_logout' | 'timeout_logout';
  trigger: 'user_action' | 'admin_action' | 'system_timeout' | 'security_policy' | 'external_request';
  
  // Session information
  session_id: string;
  user_id: string;
  client_id?: string;
  
  // Logout propagation
  affected_sessions: string[];
  notification_results: LogoutNotificationResult[];
  
  // Context
  initiator?: {
    user_id?: string;
    client_id?: string;
    ip_address?: string;
    user_agent?: string;
  };
  
  // Status
  status: 'initiated' | 'in_progress' | 'completed' | 'failed' | 'partial';
  completion_time?: string;
  failure_reason?: string;
}

export interface LogoutNotificationResult {
  client_id: string;
  client_name?: string;
  backchannel_logout_uri?: string;
  
  // Notification status
  status: 'pending' | 'sent' | 'acknowledged' | 'failed' | 'timeout';
  
  // Timing
  sent_at?: string;
  acknowledged_at?: string;
  timeout_at?: string;
  
  // Response details
  http_status?: number;
  error_code?: string;
  error_description?: string;
  
  // Retry information
  retry_count: number;
  next_retry_at?: string;
  max_retries: number;
}

export interface LogoutPolicy {
  id: string;
  name: string;
  tenantId: string;
  
  // Scope of policy
  applies_to: {
    all_users?: boolean;
    user_roles?: string[];
    specific_users?: string[];
    client_types?: string[];
    specific_clients?: string[];
  };
  
  // Logout behavior
  logout_behavior: {
    // Session management
    terminate_all_sessions: boolean;
    terminate_related_sessions: boolean;
    preserve_refresh_tokens: boolean;
    
    // Notification settings
    notify_all_clients: boolean;
    require_client_acknowledgment: boolean;
    notification_timeout_seconds: number;
    max_notification_retries: number;
    
    // Grace period
    grace_period_seconds?: number; // Allow users to cancel logout
    
    // Cascading logout
    cascade_to_related_accounts: boolean;
    cascade_depth_limit: number;
  };
  
  // Conditions for automatic logout
  auto_logout_conditions?: {
    idle_timeout_minutes?: number;
    absolute_timeout_minutes?: number;
    suspicious_activity_score?: number;
    concurrent_session_limit?: number;
    location_change_logout?: boolean;
  };
  
  // Security policies
  security_policies: {
    require_re_authentication_after: number; // seconds
    log_security_events: boolean;
    notify_security_team: boolean;
    quarantine_suspicious_sessions: boolean;
  };
  
  priority: number;
  enabled: boolean;
  
  metadata: {
    createdBy: string;
    createdAt: string;
    updatedBy: string;
    updatedAt: string;
    description?: string;
  };
}

export interface LogoutAudit {
  id: string;
  timestamp: string;
  traceId: string;
  tenantId: string;
  
  // Event identification
  logout_event_id: string;
  session_id: string;
  user_id: string;
  
  // Logout details
  logout_type: 'voluntary' | 'forced' | 'timeout' | 'security' | 'administrative';
  logout_reason?: string;
  logout_initiator?: string;
  
  // Impact assessment
  sessions_terminated: number;
  tokens_revoked: number;
  clients_notified: number;
  notification_failures: number;
  
  // Performance metrics
  total_duration_ms: number;
  notification_duration_ms?: number;
  
  // Security context
  ip_address?: string;
  user_agent?: string;
  risk_score?: number;
  
  // Compliance
  gdpr_deletion_requested?: boolean;
  data_retention_policy_applied?: boolean;
}

export interface BackchannelLogoutStats {
  total_logout_events: number;
  successful_logouts: number;
  failed_logouts: number;
  
  // Performance metrics
  average_logout_duration_ms: number;
  average_notification_time_ms: number;
  
  // Client statistics
  clients_with_backchannel: number;
  notification_success_rate: number;
  
  // Event breakdown
  logout_events_by_type: Record<string, number>;
  logout_events_by_trigger: Record<string, number>;
  
  // Time series data
  daily_logout_counts: Array<{
    date: string;
    count: number;
    success_rate: number;
  }>;
  
  // Top failure reasons
  top_failure_reasons: Array<{
    reason: string;
    count: number;
  }>;
}