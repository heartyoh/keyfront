import { 
  TokenExchangeRequest, 
  TokenExchangeResponse, 
  ExchangeableToken, 
  TokenExchangePolicy,
  TokenExchangeAudit,
  ServiceCredential,
  TokenType,
  DelegationEntry
} from '@/types/token-exchange';
import { UserSession } from '@/types/auth';
import { redisService } from './redis';
import { generateTraceId } from '@/lib/tracing';
import { metricsCollector } from '@/lib/metrics';
import { errorTracker } from './error-tracking';
import * as jwt from 'jsonwebtoken';

export class TokenExchangeService {
  private readonly policyKeyPrefix = 'token_exchange:policy:';
  private readonly serviceCredKeyPrefix = 'token_exchange:service:';
  private readonly auditKeyPrefix = 'token_exchange:audit:';
  private readonly exchangedTokenPrefix = 'token_exchange:token:';
  
  private readonly jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
  private readonly defaultIssuer = process.env.TOKEN_ISSUER || 'keyfront-bff';
  
  async exchangeToken(
    request: TokenExchangeRequest,
    requesterInfo: { clientId?: string; userId?: string; tenantId: string },
    traceId?: string
  ): Promise<TokenExchangeResponse> {
    const exchangeTraceId = traceId || generateTraceId();
    const startTime = Date.now();
    
    try {
      // Validate the subject token
      const subjectToken = await this.validateAndParseToken(
        request.subject_token, 
        request.subject_token_type
      );
      
      if (!subjectToken) {
        throw new Error('Invalid or expired subject token');
      }
      
      // Validate actor token if provided
      let actorToken: ExchangeableToken | undefined;
      if (request.actor_token) {
        actorToken = await this.validateAndParseToken(
          request.actor_token, 
          request.actor_token_type!
        );
        
        if (!actorToken) {
          throw new Error('Invalid or expired actor token');
        }
      }
      
      // Find applicable policy
      const policy = await this.findApplicablePolicy(
        requesterInfo.tenantId,
        subjectToken,
        actorToken,
        request
      );
      
      if (!policy) {
        throw new Error('No applicable token exchange policy found');
      }
      
      // Evaluate policy
      const policyResult = await this.evaluatePolicy(
        policy,
        subjectToken,
        actorToken,
        request,
        requesterInfo
      );
      
      if (!policyResult.allowed) {
        throw new Error(policyResult.reason || 'Token exchange denied by policy');
      }
      
      // Create new token
      const newToken = await this.createExchangedToken(
        subjectToken,
        actorToken,
        request,
        policy,
        policyResult
      );
      
      // Store token for tracking
      await this.storeExchangedToken(newToken);
      
      // Create response
      const response: TokenExchangeResponse = {
        access_token: newToken.token,
        issued_token_type: request.requested_token_type || 'urn:ietf:params:oauth:token-type:access_token',
        token_type: 'Bearer',
        expires_in: Math.floor((newToken.exp * 1000 - Date.now()) / 1000),
        scope: newToken.scope?.join(' '),
      };
      
      // Record metrics
      await metricsCollector.incrementCounter(
        'token_exchanges_total',
        {
          tenant_id: requesterInfo.tenantId,
          subject_type: subjectToken.type,
          requested_type: request.requested_token_type || 'access_token',
          has_actor: actorToken ? 'true' : 'false',
          success: 'true',
        },
        1,
        'Total token exchange requests'
      );
      
      await metricsCollector.observeHistogram(
        'token_exchange_duration_seconds',
        (Date.now() - startTime) / 1000,
        {
          tenant_id: requesterInfo.tenantId,
        },
        'Token exchange request duration'
      );
      
      // Audit the exchange
      await this.auditTokenExchange(
        exchangeTraceId,
        requesterInfo,
        subjectToken,
        actorToken,
        request,
        response,
        policy.id,
        true
      );
      
      return response;
      
    } catch (error) {
      console.error('Token exchange error:', error);
      
      // Record error metrics
      await metricsCollector.incrementCounter(
        'token_exchanges_total',
        {
          tenant_id: requesterInfo.tenantId,
          success: 'false',
          error_type: error instanceof Error ? error.constructor.name : 'unknown',
        },
        1,
        'Total token exchange requests'
      );
      
      // Track error
      await errorTracker.recordError({
        message: error instanceof Error ? error.message : 'Unknown token exchange error',
        type: 'TokenExchangeError',
        severity: 'high',
        traceId: exchangeTraceId,
        tenantId: requesterInfo.tenantId,
        context: {
          route: '/token/exchange',
          method: 'POST',
        },
        tags: ['token-exchange', 'oauth', 'security'],
      });
      
      // Audit the failed exchange
      await this.auditTokenExchange(
        exchangeTraceId,
        requesterInfo,
        undefined,
        undefined,
        request,
        undefined,
        undefined,
        false,
        error instanceof Error ? error.message : 'Unknown error'
      );
      
      throw error;
    }
  }
  
  private async validateAndParseToken(
    token: string, 
    tokenType: TokenType
  ): Promise<ExchangeableToken | null> {
    try {
      if (tokenType === 'urn:ietf:params:oauth:token-type:access_token' ||
          tokenType === 'urn:ietf:params:oauth:token-type:jwt') {
        
        // Verify JWT token
        const payload = jwt.verify(token, this.jwtSecret) as any;
        
        return {
          token,
          type: tokenType,
          sub: payload.sub,
          aud: payload.aud,
          scope: payload.scope ? payload.scope.split(' ') : [],
          iss: payload.iss,
          exp: payload.exp,
          iat: payload.iat,
          tenantId: payload.tenant_id || payload.tenantId,
          claims: payload,
          metadata: {
            original_token_id: payload.jti,
            exchange_count: payload.exchange_count || 0,
            max_exchanges: payload.max_exchanges,
            delegation_chain: payload.delegation_chain || [],
          },
        };
      }
      
      // Handle other token types here (SAML, etc.)
      return null;
      
    } catch (error) {
      console.error('Token validation error:', error);
      return null;
    }
  }
  
  private async findApplicablePolicy(
    tenantId: string,
    subjectToken: ExchangeableToken,
    actorToken?: ExchangeableToken,
    request?: TokenExchangeRequest
  ): Promise<TokenExchangePolicy | null> {
    try {
      const policyKeys = await redisService.getKeysByPattern(`${this.policyKeyPrefix}${tenantId}:*`);
      
      for (const key of policyKeys) {
        const policyData = await redisService.get(key);
        if (!policyData) continue;
        
        const policy: TokenExchangePolicy = JSON.parse(policyData);
        if (!policy.enabled) continue;
        
        // Check if policy applies
        if (await this.policyMatches(policy, subjectToken, actorToken, request)) {
          return policy;
        }
      }
      
      return null;
    } catch (error) {
      console.error('Error finding applicable policy:', error);
      return null;
    }
  }
  
  private async policyMatches(
    policy: TokenExchangePolicy,
    subjectToken: ExchangeableToken,
    actorToken?: ExchangeableToken,
    request?: TokenExchangeRequest
  ): Promise<boolean> {
    // Check allowed subjects
    if (!this.matchesAllowedEntity(policy.allowed_subjects, subjectToken.sub)) {
      return false;
    }
    
    // Check audience restrictions
    if (request?.audience && policy.allowed_audiences) {
      const requestedAudiences = Array.isArray(request.audience) ? request.audience : [request.audience];
      if (!requestedAudiences.some(aud => policy.allowed_audiences!.includes(aud))) {
        return false;
      }
    }
    
    // Check token type restrictions
    if (policy.conditions?.allowed_token_types) {
      if (!policy.conditions.allowed_token_types.includes(subjectToken.type)) {
        return false;
      }
    }
    
    // Check if actor token is required but not provided
    if (policy.conditions?.require_actor_token && !actorToken) {
      return false;
    }
    
    return true;
  }
  
  private matchesAllowedEntity(
    allowedEntities: { users?: string[]; services?: string[]; roles?: string[]; patterns?: string[] },
    entityId: string
  ): boolean {
    // Check direct user matches
    if (allowedEntities.users?.includes(entityId)) {
      return true;
    }
    
    // Check service matches (assuming service IDs have a specific format)
    if (allowedEntities.services?.includes(entityId)) {
      return true;
    }
    
    // Check pattern matches
    if (allowedEntities.patterns) {
      for (const pattern of allowedEntities.patterns) {
        try {
          const regex = new RegExp(pattern);
          if (regex.test(entityId)) {
            return true;
          }
        } catch (error) {
          console.error(`Invalid regex pattern: ${pattern}`, error);
        }
      }
    }
    
    return false;
  }
  
  private async evaluatePolicy(
    policy: TokenExchangePolicy,
    subjectToken: ExchangeableToken,
    actorToken: ExchangeableToken | undefined,
    request: TokenExchangeRequest,
    requesterInfo: { clientId?: string; userId?: string; tenantId: string }
  ): Promise<{ allowed: boolean; reason?: string; grantedScopes?: string[]; expiresIn?: number }> {
    
    // Check exchange limits
    if (policy.exchange_limits.max_exchanges_per_token) {
      if (subjectToken.metadata.exchange_count >= policy.exchange_limits.max_exchanges_per_token) {
        return {
          allowed: false,
          reason: 'Maximum token exchanges exceeded',
        };
      }
    }
    
    // Check delegation depth
    if (policy.exchange_limits.max_delegation_depth) {
      const delegationDepth = subjectToken.metadata.delegation_chain?.length || 0;
      if (delegationDepth >= policy.exchange_limits.max_delegation_depth) {
        return {
          allowed: false,
          reason: 'Maximum delegation depth exceeded',
        };
      }
    }
    
    // Evaluate scope policy
    const scopeResult = this.evaluateScopePolicy(policy.scope_policy, subjectToken, request);
    if (!scopeResult.allowed) {
      return scopeResult;
    }
    
    // Calculate token lifetime
    const maxExpiresIn = policy.token_lifetime.max_expires_in;
    const defaultExpiresIn = policy.token_lifetime.default_expires_in;
    let expiresIn = defaultExpiresIn;
    
    if (maxExpiresIn && expiresIn > maxExpiresIn) {
      expiresIn = maxExpiresIn;
    }
    
    return {
      allowed: true,
      grantedScopes: scopeResult.grantedScopes,
      expiresIn,
    };
  }
  
  private evaluateScopePolicy(
    scopePolicy: TokenExchangePolicy['scope_policy'],
    subjectToken: ExchangeableToken,
    request: TokenExchangeRequest
  ): { allowed: boolean; reason?: string; grantedScopes?: string[] } {
    
    const requestedScopes = request.scope ? request.scope.split(' ') : [];
    const subjectScopes = subjectToken.scope || [];
    
    // If inherit from subject, start with subject scopes
    let candidateScopes = scopePolicy.inherit_from_subject ? [...subjectScopes] : [...requestedScopes];
    
    // Apply scope restrictions
    if (scopePolicy.allowed_scopes) {
      candidateScopes = candidateScopes.filter(scope => 
        scopePolicy.allowed_scopes!.includes(scope)
      );
    }
    
    // Remove denied scopes
    if (scopePolicy.deny_scopes) {
      candidateScopes = candidateScopes.filter(scope => 
        !scopePolicy.deny_scopes!.includes(scope)
      );
    }
    
    // Check required scopes
    if (scopePolicy.required_scopes) {
      const missingScopes = scopePolicy.required_scopes.filter(scope => 
        !candidateScopes.includes(scope)
      );
      if (missingScopes.length > 0) {
        return {
          allowed: false,
          reason: `Missing required scopes: ${missingScopes.join(', ')}`,
        };
      }
    }
    
    // Check downscope-only restriction
    if (scopePolicy.downscope_only) {
      const expandedScopes = candidateScopes.filter(scope => 
        !subjectScopes.includes(scope)
      );
      if (expandedScopes.length > 0) {
        return {
          allowed: false,
          reason: `Cannot expand scopes beyond subject token: ${expandedScopes.join(', ')}`,
        };
      }
    }
    
    return {
      allowed: true,
      grantedScopes: candidateScopes,
    };
  }
  
  private async createExchangedToken(
    subjectToken: ExchangeableToken,
    actorToken: ExchangeableToken | undefined,
    request: TokenExchangeRequest,
    policy: TokenExchangePolicy,
    policyResult: { grantedScopes?: string[]; expiresIn?: number }
  ): Promise<ExchangeableToken> {
    
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = policyResult.expiresIn || policy.token_lifetime.default_expires_in;
    const exp = now + expiresIn;
    
    // Create delegation chain entry
    const delegationEntry: DelegationEntry = {
      actor: actorToken?.sub || subjectToken.sub,
      subject: subjectToken.sub,
      timestamp: new Date().toISOString(),
      audience: Array.isArray(request.audience) ? request.audience[0] : request.audience,
      scope: policyResult.grantedScopes,
    };
    
    const delegationChain = [...(subjectToken.metadata.delegation_chain || []), delegationEntry];
    
    // Create new token payload
    const tokenPayload = {
      iss: this.defaultIssuer,
      sub: subjectToken.sub,
      aud: request.audience,
      exp,
      iat: now,
      jti: generateTraceId(),
      scope: policyResult.grantedScopes?.join(' '),
      tenant_id: subjectToken.tenantId,
      
      // Token exchange specific claims
      token_type: 'Bearer',
      exchange_count: subjectToken.metadata.exchange_count + 1,
      max_exchanges: policy.exchange_limits.max_exchanges_per_token,
      delegation_chain: delegationChain,
      original_token_id: subjectToken.metadata.original_token_id || subjectToken.claims?.jti,
      
      // Actor information (if present)
      ...(actorToken && { act: { sub: actorToken.sub } }),
    };
    
    // Sign the token
    const token = jwt.sign(tokenPayload, this.jwtSecret, { 
      algorithm: 'HS256',
      keyid: 'keyfront-token-exchange',
    });
    
    return {
      token,
      type: request.requested_token_type || 'urn:ietf:params:oauth:token-type:access_token',
      sub: subjectToken.sub,
      aud: request.audience,
      scope: policyResult.grantedScopes,
      iss: this.defaultIssuer,
      exp,
      iat: now,
      tenantId: subjectToken.tenantId,
      claims: tokenPayload,
      metadata: {
        original_token_id: subjectToken.metadata.original_token_id || subjectToken.claims?.jti,
        exchange_count: subjectToken.metadata.exchange_count + 1,
        max_exchanges: policy.exchange_limits.max_exchanges_per_token,
        delegation_chain: delegationChain,
      },
    };
  }
  
  private async storeExchangedToken(token: ExchangeableToken): Promise<void> {
    try {
      const tokenKey = `${this.exchangedTokenPrefix}${token.claims?.jti}`;
      const ttl = token.exp - Math.floor(Date.now() / 1000);
      
      await redisService.set(tokenKey, JSON.stringify(token), ttl);
    } catch (error) {
      console.error('Failed to store exchanged token:', error);
    }
  }
  
  private async auditTokenExchange(
    traceId: string,
    requesterInfo: { clientId?: string; userId?: string; tenantId: string },
    subjectToken?: ExchangeableToken,
    actorToken?: ExchangeableToken,
    request?: TokenExchangeRequest,
    response?: TokenExchangeResponse,
    policyId?: string,
    success: boolean = false,
    denialReason?: string
  ): Promise<void> {
    try {
      const audit: TokenExchangeAudit = {
        id: generateTraceId(),
        timestamp: new Date().toISOString(),
        traceId,
        tenantId: requesterInfo.tenantId,
        requester: requesterInfo.clientId || requesterInfo.userId || 'unknown',
        subject_token_sub: subjectToken?.sub || 'unknown',
        actor_token_sub: actorToken?.sub,
        requested_audience: Array.isArray(request?.audience) ? request?.audience[0] : request?.audience,
        requested_scope: request?.scope,
        success,
        issued_token: response ? {
          sub: subjectToken?.sub || 'unknown',
          aud: Array.isArray(request?.audience) ? request?.audience[0] : request?.audience,
          scope: response.scope,
          expires_in: response.expires_in,
        } : undefined,
        applied_policy: policyId,
        denial_reason: denialReason,
      };
      
      await redisService.set(
        `${this.auditKeyPrefix}${audit.id}`,
        JSON.stringify(audit),
        30 * 24 * 60 * 60 // 30 days
      );
    } catch (error) {
      console.error('Failed to audit token exchange:', error);
    }
  }
  
  // Policy management methods
  async createPolicy(policy: Omit<TokenExchangePolicy, 'id'>): Promise<TokenExchangePolicy> {
    const newPolicy: TokenExchangePolicy = {
      ...policy,
      id: generateTraceId(),
    };
    
    const policyKey = `${this.policyKeyPrefix}${policy.tenantId}:${newPolicy.id}`;
    await redisService.set(policyKey, JSON.stringify(newPolicy), 365 * 24 * 60 * 60); // 1 year
    
    return newPolicy;
  }
  
  async updatePolicy(
    policyId: string, 
    tenantId: string, 
    updates: Partial<TokenExchangePolicy>
  ): Promise<TokenExchangePolicy | null> {
    const policyKey = `${this.policyKeyPrefix}${tenantId}:${policyId}`;
    const existingData = await redisService.get(policyKey);
    
    if (!existingData) return null;
    
    const existingPolicy: TokenExchangePolicy = JSON.parse(existingData);
    const updatedPolicy: TokenExchangePolicy = {
      ...existingPolicy,
      ...updates,
      id: policyId,
      metadata: {
        ...existingPolicy.metadata,
        ...updates.metadata,
        updatedAt: new Date().toISOString(),
      },
    };
    
    await redisService.set(policyKey, JSON.stringify(updatedPolicy), 365 * 24 * 60 * 60);
    
    return updatedPolicy;
  }
  
  async listPolicies(tenantId: string): Promise<TokenExchangePolicy[]> {
    try {
      const policyKeys = await redisService.getKeysByPattern(`${this.policyKeyPrefix}${tenantId}:*`);
      const policies: TokenExchangePolicy[] = [];
      
      for (const key of policyKeys) {
        const policyData = await redisService.get(key);
        if (policyData) {
          policies.push(JSON.parse(policyData));
        }
      }
      
      return policies.sort((a, b) => b.metadata.createdAt.localeCompare(a.metadata.createdAt));
    } catch (error) {
      console.error('Failed to list token exchange policies:', error);
      return [];
    }
  }
}

export const tokenExchangeService = new TokenExchangeService();