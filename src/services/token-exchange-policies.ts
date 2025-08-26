import { TokenExchangePolicy } from '@/types/token-exchange';
import { tokenExchangeService } from './token-exchange';
import { generateTraceId } from '@/lib/tracing';

export class TokenExchangePolicyTemplates {
  
  static createServiceToServicePolicy(tenantId: string, createdBy: string): TokenExchangePolicy {
    return {
      id: generateTraceId(),
      name: 'Service-to-Service Token Exchange',
      tenantId,
      
      allowed_subjects: {
        services: [`${tenantId}-service-*`],
        patterns: [`${tenantId}-service-.+`],
      },
      
      allowed_audiences: [
        `${tenantId}-api`,
        `${tenantId}-service-auth`,
        `${tenantId}-service-data`,
        `${tenantId}-service-notification`,
      ],
      
      scope_policy: {
        allowed_scopes: [
          'read:users',
          'write:users',
          'read:data',
          'write:data',
          'admin:config',
        ],
        inherit_from_subject: true,
        downscope_only: true,
      },
      
      token_lifetime: {
        max_expires_in: 7200, // 2 hours
        default_expires_in: 3600, // 1 hour
      },
      
      exchange_limits: {
        max_exchanges_per_token: 3,
        max_delegation_depth: 2,
      },
      
      conditions: {
        require_actor_token: false,
        allowed_token_types: [
          'urn:ietf:params:oauth:token-type:access_token',
          'urn:ietf:params:oauth:token-type:jwt',
        ],
      },
      
      enabled: true,
      
      metadata: {
        createdBy,
        createdAt: new Date().toISOString(),
        updatedBy: createdBy,
        updatedAt: new Date().toISOString(),
        description: 'Allows services to exchange tokens for accessing other services within the same tenant',
      },
    };
  }
  
  static createUserDelegationPolicy(tenantId: string, createdBy: string): TokenExchangePolicy {
    return {
      id: generateTraceId(),
      name: 'User Delegation Policy',
      tenantId,
      
      allowed_subjects: {
        roles: ['admin', 'service_account'],
        services: [`${tenantId}-service-*`],
      },
      
      allowed_targets: {
        users: [], // Will be populated dynamically
        roles: ['user', 'viewer'],
      },
      
      allowed_audiences: [
        `${tenantId}-api`,
        `${tenantId}-service-data`,
      ],
      
      scope_policy: {
        allowed_scopes: [
          'read:profile',
          'read:data',
          'write:data',
        ],
        required_scopes: ['delegation'],
        deny_scopes: ['admin:*', 'delete:*'],
        inherit_from_subject: false,
        downscope_only: true,
      },
      
      token_lifetime: {
        max_expires_in: 1800, // 30 minutes
        default_expires_in: 900, // 15 minutes
      },
      
      exchange_limits: {
        max_exchanges_per_token: 1,
        max_delegation_depth: 1,
      },
      
      conditions: {
        require_actor_token: true,
        allowed_token_types: [
          'urn:ietf:params:oauth:token-type:access_token',
        ],
        time_restrictions: {
          business_hours_only: true,
          allowed_days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        },
      },
      
      enabled: true,
      
      metadata: {
        createdBy,
        createdAt: new Date().toISOString(),
        updatedBy: createdBy,
        updatedAt: new Date().toISOString(),
        description: 'Allows authorized services to act on behalf of users with restricted scopes',
      },
    };
  }
  
  static createImpersonationPolicy(tenantId: string, createdBy: string): TokenExchangePolicy {
    return {
      id: generateTraceId(),
      name: 'Admin Impersonation Policy',
      tenantId,
      
      allowed_subjects: {
        roles: ['admin', 'support'],
        users: [], // Specific admin users only
      },
      
      allowed_targets: {
        roles: ['user'],
        patterns: [`${tenantId}-.+`], // Any user in the tenant
      },
      
      allowed_audiences: [
        `${tenantId}-api`,
        `${tenantId}-service-support`,
      ],
      
      scope_policy: {
        allowed_scopes: [
          'read:profile',
          'read:data',
          'write:data',
          'read:audit',
        ],
        required_scopes: ['impersonation'],
        deny_scopes: ['admin:*', 'delete:*', 'modify:users'],
        inherit_from_subject: false,
        downscope_only: false,
      },
      
      token_lifetime: {
        max_expires_in: 3600, // 1 hour
        default_expires_in: 1800, // 30 minutes
      },
      
      exchange_limits: {
        max_exchanges_per_token: 1,
        max_delegation_depth: 1,
      },
      
      conditions: {
        require_actor_token: false,
        allowed_token_types: [
          'urn:ietf:params:oauth:token-type:access_token',
        ],
        time_restrictions: {
          business_hours_only: false, // Support may need 24/7 access
        },
      },
      
      enabled: false, // Disabled by default for security
      
      metadata: {
        createdBy,
        createdAt: new Date().toISOString(),
        updatedBy: createdBy,
        updatedAt: new Date().toISOString(),
        description: 'Allows administrators to impersonate users for support purposes (DISABLED BY DEFAULT)',
      },
    };
  }
  
  static createDownscopingPolicy(tenantId: string, createdBy: string): TokenExchangePolicy {
    return {
      id: generateTraceId(),
      name: 'Token Downscoping Policy',
      tenantId,
      
      allowed_subjects: {
        roles: ['user', 'admin', 'service_account'],
        services: [`${tenantId}-service-*`],
        patterns: [`.+`], // Allow any authenticated subject
      },
      
      allowed_audiences: [
        `${tenantId}-api`,
        `${tenantId}-service-data`,
        `${tenantId}-service-file`,
        `${tenantId}-service-notification`,
      ],
      
      scope_policy: {
        allowed_scopes: [
          'read:profile',
          'read:data',
          'read:files',
          'write:files',
        ],
        inherit_from_subject: true,
        downscope_only: true, // Strictly downscoping only
      },
      
      token_lifetime: {
        max_expires_in: 3600, // 1 hour
        default_expires_in: 1800, // 30 minutes
      },
      
      exchange_limits: {
        max_exchanges_per_token: 5,
        max_delegation_depth: 3,
      },
      
      conditions: {
        require_actor_token: false,
        allowed_token_types: [
          'urn:ietf:params:oauth:token-type:access_token',
          'urn:ietf:params:oauth:token-type:jwt',
        ],
      },
      
      enabled: true,
      
      metadata: {
        createdBy,
        createdAt: new Date().toISOString(),
        updatedBy: createdBy,
        updatedAt: new Date().toISOString(),
        description: 'Allows any authenticated subject to create tokens with reduced scopes for specific services',
      },
    };
  }
  
  static createCrossServicePolicy(tenantId: string, createdBy: string): TokenExchangePolicy {
    return {
      id: generateTraceId(),
      name: 'Cross-Service Integration Policy',
      tenantId,
      
      allowed_subjects: {
        services: [
          `${tenantId}-service-gateway`,
          `${tenantId}-service-orchestrator`,
          `${tenantId}-service-workflow`,
        ],
      },
      
      allowed_audiences: [
        `${tenantId}-service-auth`,
        `${tenantId}-service-data`,
        `${tenantId}-service-file`,
        `${tenantId}-service-notification`,
        `${tenantId}-service-audit`,
      ],
      
      scope_policy: {
        allowed_scopes: [
          'service:read',
          'service:write',
          'service:execute',
          'internal:communication',
        ],
        required_scopes: ['service:access'],
        inherit_from_subject: true,
        downscope_only: false,
      },
      
      token_lifetime: {
        max_expires_in: 14400, // 4 hours
        default_expires_in: 7200, // 2 hours
      },
      
      exchange_limits: {
        max_exchanges_per_token: 10,
        max_delegation_depth: 5,
      },
      
      conditions: {
        require_actor_token: false,
        allowed_token_types: [
          'urn:ietf:params:oauth:token-type:access_token',
          'urn:ietf:params:oauth:token-type:jwt',
        ],
      },
      
      enabled: true,
      
      metadata: {
        createdBy,
        createdAt: new Date().toISOString(),
        updatedBy: createdBy,
        updatedAt: new Date().toISOString(),
        description: 'Enables service-to-service communication with token exchange for microservices architecture',
      },
    };
  }
  
  static async initializeDefaultPolicies(tenantId: string, createdBy: string): Promise<TokenExchangePolicy[]> {
    const policies = [
      this.createServiceToServicePolicy(tenantId, createdBy),
      this.createUserDelegationPolicy(tenantId, createdBy),
      this.createImpersonationPolicy(tenantId, createdBy),
      this.createDownscopingPolicy(tenantId, createdBy),
      this.createCrossServicePolicy(tenantId, createdBy),
    ];
    
    const createdPolicies: TokenExchangePolicy[] = [];
    
    for (const policy of policies) {
      try {
        const created = await tokenExchangeService.createPolicy(policy);
        createdPolicies.push(created);
        console.log(`Created token exchange policy: ${policy.name}`);
      } catch (error) {
        console.error(`Failed to create token exchange policy ${policy.name}:`, error);
      }
    }
    
    return createdPolicies;
  }
}

export const tokenExchangePolicyTemplates = new TokenExchangePolicyTemplates();