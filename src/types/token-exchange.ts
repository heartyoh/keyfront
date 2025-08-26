export type TokenType = 
  | 'urn:ietf:params:oauth:token-type:access_token'
  | 'urn:ietf:params:oauth:token-type:refresh_token'
  | 'urn:ietf:params:oauth:token-type:id_token'
  | 'urn:ietf:params:oauth:token-type:saml2'
  | 'urn:ietf:params:oauth:token-type:jwt';

export type GrantType = 'urn:ietf:params:oauth:grant-type:token-exchange';

export interface TokenExchangeRequest {
  grant_type: GrantType;
  
  // Required: The security token that represents the identity of the party on behalf of whom the request is being made
  subject_token: string;
  subject_token_type: TokenType;
  
  // Optional: Actor token for delegation scenarios
  actor_token?: string;
  actor_token_type?: TokenType;
  
  // Optional: Requested token type
  requested_token_type?: TokenType;
  
  // Optional: Target service/audience
  audience?: string | string[];
  
  // Optional: Requested scopes
  scope?: string;
  
  // Optional: Resource indicators
  resource?: string | string[];
}

export interface TokenExchangeResponse {
  access_token: string;
  issued_token_type: TokenType;
  token_type: 'Bearer';
  expires_in?: number;
  scope?: string;
  refresh_token?: string;
}

export interface ExchangeableToken {
  token: string;
  type: TokenType;
  sub: string;
  aud?: string | string[];
  scope?: string[];
  iss: string;
  exp: number;
  iat: number;
  tenantId: string;
  
  // Additional claims
  claims?: Record<string, any>;
  
  // Token metadata
  metadata: {
    original_token_id?: string;
    exchange_count: number;
    max_exchanges?: number;
    delegation_chain?: DelegationEntry[];
  };
}

export interface DelegationEntry {
  actor: string;
  subject: string;
  timestamp: string;
  audience?: string;
  scope?: string[];
}

export interface TokenExchangePolicy {
  id: string;
  name: string;
  tenantId: string;
  
  // Who can request token exchange
  allowed_subjects: {
    users?: string[];
    services?: string[];
    roles?: string[];
    patterns?: string[]; // Regex patterns
  };
  
  // Who can be impersonated (for impersonation flow)
  allowed_targets?: {
    users?: string[];
    services?: string[];
    roles?: string[];
    patterns?: string[];
  };
  
  // Which audiences are allowed
  allowed_audiences?: string[];
  
  // Which resources can be accessed
  allowed_resources?: string[];
  
  // Scope restrictions
  scope_policy: {
    allowed_scopes?: string[];
    required_scopes?: string[];
    deny_scopes?: string[];
    inherit_from_subject?: boolean;
    downscope_only?: boolean; // Can only reduce scopes, not expand
  };
  
  // Token lifetime controls
  token_lifetime: {
    max_expires_in?: number;
    default_expires_in: number;
  };
  
  // Exchange limits
  exchange_limits: {
    max_exchanges_per_token?: number;
    max_delegation_depth?: number;
  };
  
  // Conditions
  conditions?: {
    require_actor_token?: boolean;
    allowed_token_types?: TokenType[];
    time_restrictions?: {
      business_hours_only?: boolean;
      allowed_days?: string[];
    };
  };
  
  enabled: boolean;
  
  metadata: {
    createdBy: string;
    createdAt: string;
    updatedBy: string;
    updatedAt: string;
    description?: string;
  };
}

export interface TokenExchangeAudit {
  id: string;
  timestamp: string;
  traceId: string;
  tenantId: string;
  
  // Request details
  requester: string;
  subject_token_sub: string;
  actor_token_sub?: string;
  requested_audience?: string;
  requested_scope?: string;
  
  // Response details
  success: boolean;
  issued_token?: {
    sub: string;
    aud?: string;
    scope?: string;
    expires_in?: number;
  };
  
  // Policy evaluation
  applied_policy?: string;
  denial_reason?: string;
  
  // Context
  ip_address?: string;
  user_agent?: string;
  
  // Security
  risk_score?: number;
  anomaly_detected?: boolean;
}

export interface ServiceCredential {
  client_id: string;
  client_secret: string;
  service_name: string;
  tenantId: string;
  
  // Allowed operations
  permissions: {
    can_exchange_tokens: boolean;
    can_impersonate: boolean;
    allowed_audiences?: string[];
    allowed_scopes?: string[];
  };
  
  // Security
  public_key?: string; // For JWT assertion validation
  certificate?: string;
  
  metadata: {
    createdBy: string;
    createdAt: string;
    expiresAt?: string;
    description?: string;
  };
  
  enabled: boolean;
}