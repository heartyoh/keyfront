import { 
  AccessRequest, 
  AccessDecision, 
  Policy, 
  PolicyRule, 
  PolicyMatcher, 
  PolicyCondition,
  PolicyCombiningAlgorithm,
  AttributeProvider,
  Subject,
  Resource,
  Environment,
  Obligation,
  Advice,
  AuditEntry
} from '@/types/abac';
import { redisService } from './redis';
import { generateTraceId } from '@/lib/tracing';
import { metricsCollector } from '@/lib/metrics';

export class AbacPolicyEngine {
  private readonly policyKeyPrefix = 'abac:policy:';
  private readonly policySetKeyPrefix = 'abac:policyset:';
  private readonly auditKeyPrefix = 'abac:audit:';
  
  private attributeProviders: Map<string, AttributeProvider> = new Map();
  private combiningAlgorithms: Map<string, PolicyCombiningAlgorithm> = new Map();
  
  constructor() {
    this.initializeCombiningAlgorithms();
  }
  
  private initializeCombiningAlgorithms() {
    // Deny Overrides: If any policy evaluates to Deny, the result is Deny
    this.combiningAlgorithms.set('deny_overrides', {
      name: 'deny_overrides',
      combine: (decisions: AccessDecision[]): AccessDecision => {
        const denyDecision = decisions.find(d => d.decision === 'deny');
        if (denyDecision) {
          return {
            ...denyDecision,
            reason: 'Access denied by deny-overrides algorithm',
            appliedPolicies: decisions.flatMap(d => d.appliedPolicies),
          };
        }
        
        const permitDecision = decisions.find(d => d.decision === 'permit');
        if (permitDecision) {
          return {
            ...permitDecision,
            reason: 'Access permitted by deny-overrides algorithm',
            appliedPolicies: decisions.flatMap(d => d.appliedPolicies),
          };
        }
        
        return {
          decision: 'not_applicable',
          reason: 'No applicable policies found',
          appliedPolicies: [],
          evaluationTime: 0,
          traceId: generateTraceId(),
        };
      }
    });
    
    // Permit Overrides: If any policy evaluates to Permit, the result is Permit
    this.combiningAlgorithms.set('permit_overrides', {
      name: 'permit_overrides',
      combine: (decisions: AccessDecision[]): AccessDecision => {
        const permitDecision = decisions.find(d => d.decision === 'permit');
        if (permitDecision) {
          return {
            ...permitDecision,
            reason: 'Access permitted by permit-overrides algorithm',
            appliedPolicies: decisions.flatMap(d => d.appliedPolicies),
          };
        }
        
        const denyDecision = decisions.find(d => d.decision === 'deny');
        if (denyDecision) {
          return {
            ...denyDecision,
            reason: 'Access denied by permit-overrides algorithm',
            appliedPolicies: decisions.flatMap(d => d.appliedPolicies),
          };
        }
        
        return {
          decision: 'not_applicable',
          reason: 'No applicable policies found',
          appliedPolicies: [],
          evaluationTime: 0,
          traceId: generateTraceId(),
        };
      }
    });
  }
  
  async evaluateAccess(request: AccessRequest, traceId?: string): Promise<AccessDecision> {
    const startTime = Date.now();
    const evaluationTraceId = traceId || generateTraceId();
    
    try {
      // Load applicable policies
      const policies = await this.loadApplicablePolicies(request.subject.tenantId);
      
      // Enhance request with dynamic attributes
      const enhancedRequest = await this.enhanceRequestWithAttributes(request);
      
      // Evaluate each policy
      const policyDecisions: AccessDecision[] = [];
      
      for (const policy of policies) {
        if (!policy.enabled) continue;
        
        const policyDecision = await this.evaluatePolicy(policy, enhancedRequest, evaluationTraceId);
        if (policyDecision.decision !== 'not_applicable') {
          policyDecisions.push(policyDecision);
        }
      }
      
      // Combine decisions using deny-overrides algorithm (default)
      const algorithm = this.combiningAlgorithms.get('deny_overrides')!;
      const finalDecision = algorithm.combine(policyDecisions);
      
      const evaluationTime = Date.now() - startTime;
      finalDecision.evaluationTime = evaluationTime;
      finalDecision.traceId = evaluationTraceId;
      
      // Record metrics
      await metricsCollector.incrementCounter(
        'abac_evaluations_total',
        {
          tenant_id: request.subject.tenantId,
          decision: finalDecision.decision,
          resource_type: request.resource.type,
          action_type: request.action.type,
        },
        1,
        'Total ABAC policy evaluations'
      );
      
      await metricsCollector.observeHistogram(
        'abac_evaluation_duration_seconds',
        evaluationTime / 1000,
        {
          tenant_id: request.subject.tenantId,
          policies_count: policies.length.toString(),
        },
        'ABAC policy evaluation duration in seconds'
      );
      
      // Audit the decision
      await this.auditAccessDecision(enhancedRequest, finalDecision);
      
      return finalDecision;
    } catch (error) {
      console.error('ABAC evaluation error:', error);
      
      const errorDecision: AccessDecision = {
        decision: 'indeterminate',
        reason: `Policy evaluation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        appliedPolicies: [],
        evaluationTime: Date.now() - startTime,
        traceId: evaluationTraceId,
      };
      
      return errorDecision;
    }
  }
  
  private async loadApplicablePolicies(tenantId: string): Promise<Policy[]> {
    try {
      const policyKeys = await redisService.getKeysByPattern(`${this.policyKeyPrefix}${tenantId}:*`);
      const policies: Policy[] = [];
      
      for (const key of policyKeys) {
        const policyData = await redisService.get(key);
        if (policyData) {
          const policy: Policy = JSON.parse(policyData);
          policies.push(policy);
        }
      }
      
      // Sort by priority (higher priority first)
      return policies.sort((a, b) => {
        const aPriority = Math.max(...a.rules.map(r => r.priority));
        const bPriority = Math.max(...b.rules.map(r => r.priority));
        return bPriority - aPriority;
      });
    } catch (error) {
      console.error('Failed to load policies:', error);
      return [];
    }
  }
  
  private async enhanceRequestWithAttributes(request: AccessRequest): Promise<AccessRequest> {
    // Apply attribute providers
    let enhancedAttributes = { ...request.subject.attributes };
    
    for (const provider of this.attributeProviders.values()) {
      try {
        const additionalAttributes = await provider.getAttributes(
          request.subject, 
          request.resource, 
          request.environment
        );
        enhancedAttributes = { ...enhancedAttributes, ...additionalAttributes };
      } catch (error) {
        console.error(`Attribute provider ${provider.name} failed:`, error);
      }
    }
    
    return {
      ...request,
      subject: {
        ...request.subject,
        attributes: enhancedAttributes,
      },
    };
  }
  
  private async evaluatePolicy(policy: Policy, request: AccessRequest, traceId: string): Promise<AccessDecision> {
    const ruleDecisions: AccessDecision[] = [];
    
    for (const rule of policy.rules) {
      if (!rule.enabled) continue;
      
      const ruleDecision = await this.evaluateRule(rule, request, traceId);
      if (ruleDecision.decision !== 'not_applicable') {
        ruleDecisions.push(ruleDecision);
      }
    }
    
    if (ruleDecisions.length === 0) {
      return {
        decision: 'not_applicable',
        reason: `No applicable rules in policy ${policy.name}`,
        appliedPolicies: [],
        evaluationTime: 0,
        traceId,
      };
    }
    
    // Use first applicable rule
    const applicableDecision = ruleDecisions[0];
    applicableDecision.appliedPolicies = [policy.id];
    
    return applicableDecision;
  }
  
  private async evaluateRule(rule: PolicyRule, request: AccessRequest, traceId: string): Promise<AccessDecision> {
    try {
      // Check if target matches
      const targetMatches = await this.evaluateTarget(rule.target, request);
      if (!targetMatches) {
        return {
          decision: 'not_applicable',
          reason: `Rule ${rule.name} target does not match`,
          appliedPolicies: [],
          evaluationTime: 0,
          traceId,
        };
      }
      
      // Check conditions
      if (rule.condition && rule.condition.length > 0) {
        const conditionMatches = await this.evaluateConditions(rule.condition, request);
        if (!conditionMatches) {
          return {
            decision: 'not_applicable',
            reason: `Rule ${rule.name} conditions not satisfied`,
            appliedPolicies: [],
            evaluationTime: 0,
            traceId,
          };
        }
      }
      
      return {
        decision: rule.effect,
        reason: `Rule ${rule.name} applied: ${rule.effect}`,
        appliedPolicies: [],
        evaluationTime: 0,
        traceId,
      };
    } catch (error) {
      console.error(`Rule evaluation error for ${rule.name}:`, error);
      return {
        decision: 'indeterminate',
        reason: `Rule evaluation error: ${error instanceof Error ? error.message : 'Unknown'}`,
        appliedPolicies: [],
        evaluationTime: 0,
        traceId,
      };
    }
  }
  
  private async evaluateTarget(target: any, request: AccessRequest): Promise<boolean> {
    // Evaluate subject matchers
    if (target.subjects) {
      const subjectMatches = target.subjects.some((matcher: PolicyMatcher) => 
        this.evaluateMatcher(matcher, request.subject, request)
      );
      if (!subjectMatches) return false;
    }
    
    // Evaluate resource matchers
    if (target.resources) {
      const resourceMatches = target.resources.some((matcher: PolicyMatcher) => 
        this.evaluateMatcher(matcher, request.resource, request)
      );
      if (!resourceMatches) return false;
    }
    
    // Evaluate action matchers
    if (target.actions) {
      const actionMatches = target.actions.some((matcher: PolicyMatcher) => 
        this.evaluateMatcher(matcher, request.action, request)
      );
      if (!actionMatches) return false;
    }
    
    // Evaluate environment matchers
    if (target.environments) {
      const envMatches = target.environments.some((matcher: PolicyMatcher) => 
        this.evaluateMatcher(matcher, request.environment, request)
      );
      if (!envMatches) return false;
    }
    
    return true;
  }
  
  private async evaluateConditions(conditions: PolicyCondition[], request: AccessRequest): Promise<boolean> {
    for (const condition of conditions) {
      const conditionMet = this.evaluateMatcher(condition, request, request);
      if (!conditionMet) {
        return false;
      }
    }
    return true;
  }
  
  private evaluateMatcher(matcher: PolicyMatcher, target: any, context: AccessRequest): boolean {
    const attributeValue = this.getAttributeValue(matcher.attribute, target, context);
    
    switch (matcher.operator) {
      case 'equals':
        return attributeValue === matcher.value;
      case 'not_equals':
        return attributeValue !== matcher.value;
      case 'contains':
        return Array.isArray(attributeValue) ? 
          attributeValue.includes(matcher.value) : 
          String(attributeValue).includes(String(matcher.value));
      case 'not_contains':
        return Array.isArray(attributeValue) ? 
          !attributeValue.includes(matcher.value) : 
          !String(attributeValue).includes(String(matcher.value));
      case 'greater_than':
        return Number(attributeValue) > Number(matcher.value);
      case 'less_than':
        return Number(attributeValue) < Number(matcher.value);
      case 'in':
        return Array.isArray(matcher.value) ? matcher.value.includes(attributeValue) : false;
      case 'not_in':
        return Array.isArray(matcher.value) ? !matcher.value.includes(attributeValue) : true;
      case 'regex':
        try {
          const regex = new RegExp(matcher.value);
          return regex.test(String(attributeValue));
        } catch {
          return false;
        }
      case 'exists':
        return attributeValue !== undefined && attributeValue !== null;
      case 'not_exists':
        return attributeValue === undefined || attributeValue === null;
      default:
        return false;
    }
  }
  
  private getAttributeValue(attribute: string, target: any, context: AccessRequest): any {
    const parts = attribute.split('.');
    let value = target;
    
    for (const part of parts) {
      if (value && typeof value === 'object') {
        value = value[part];
      } else {
        return undefined;
      }
    }
    
    return value;
  }
  
  private async auditAccessDecision(request: AccessRequest, decision: AccessDecision): Promise<void> {
    try {
      const auditEntry: AuditEntry = {
        id: generateTraceId(),
        timestamp: new Date().toISOString(),
        traceId: decision.traceId,
        tenantId: request.subject.tenantId,
        request,
        decision,
        evaluationTime: decision.evaluationTime,
        policiesEvaluated: decision.appliedPolicies.length,
        ipAddress: request.environment.ipAddress,
        userAgent: request.environment.userAgent,
        riskScore: request.environment.riskScore,
      };
      
      await redisService.set(
        `${this.auditKeyPrefix}${auditEntry.id}`,
        JSON.stringify(auditEntry),
        30 * 24 * 60 * 60 // 30 days TTL
      );
    } catch (error) {
      console.error('Failed to audit access decision:', error);
    }
  }
  
  async createPolicy(policy: Omit<Policy, 'id'>): Promise<Policy> {
    const newPolicy: Policy = {
      ...policy,
      id: generateTraceId(),
    };
    
    const policyKey = `${this.policyKeyPrefix}${policy.tenantId}:${newPolicy.id}`;
    await redisService.set(policyKey, JSON.stringify(newPolicy), 365 * 24 * 60 * 60); // 1 year TTL
    
    return newPolicy;
  }
  
  async updatePolicy(policyId: string, tenantId: string, updates: Partial<Policy>): Promise<Policy | null> {
    const policyKey = `${this.policyKeyPrefix}${tenantId}:${policyId}`;
    const existingData = await redisService.get(policyKey);
    
    if (!existingData) return null;
    
    const existingPolicy: Policy = JSON.parse(existingData);
    const updatedPolicy: Policy = {
      ...existingPolicy,
      ...updates,
      id: policyId, // Ensure ID doesn't change
      metadata: {
        ...existingPolicy.metadata,
        ...updates.metadata,
        updatedAt: new Date().toISOString(),
      },
    };
    
    await redisService.set(policyKey, JSON.stringify(updatedPolicy), 365 * 24 * 60 * 60);
    
    return updatedPolicy;
  }
  
  async deletePolicy(policyId: string, tenantId: string): Promise<boolean> {
    const policyKey = `${this.policyKeyPrefix}${tenantId}:${policyId}`;
    const deleted = await redisService.delete(policyKey);
    return deleted > 0;
  }
  
  async listPolicies(tenantId: string): Promise<Policy[]> {
    const policies = await this.loadApplicablePolicies(tenantId);
    return policies;
  }
  
  registerAttributeProvider(provider: AttributeProvider): void {
    this.attributeProviders.set(provider.name, provider);
  }
  
  unregisterAttributeProvider(name: string): void {
    this.attributeProviders.delete(name);
  }
}

export const abacEngine = new AbacPolicyEngine();