export interface Subject {
  id: string;
  type: 'user' | 'service' | 'group';
  tenantId: string;
  roles: string[];
  attributes: Record<string, any>;
  groups?: string[];
  department?: string;
  clearanceLevel?: number;
}

export interface Resource {
  id: string;
  type: string;
  tenantId: string;
  ownerId?: string;
  attributes: Record<string, any>;
  tags?: string[];
  classification?: 'public' | 'internal' | 'confidential' | 'secret';
}

export interface Action {
  name: string;
  type: 'read' | 'write' | 'delete' | 'execute' | 'admin';
  attributes: Record<string, any>;
}

export interface Environment {
  timestamp: string;
  ipAddress?: string;
  userAgent?: string;
  location?: {
    country?: string;
    region?: string;
    city?: string;
  };
  timeOfDay?: 'morning' | 'afternoon' | 'evening' | 'night';
  dayOfWeek?: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
  isBusinessHours?: boolean;
  riskScore?: number;
}

export interface AccessRequest {
  subject: Subject;
  resource: Resource;
  action: Action;
  environment: Environment;
  context?: Record<string, any>;
}

export type PolicyEffect = 'permit' | 'deny';

export type PolicyTarget = {
  subjects?: PolicyMatcher[];
  resources?: PolicyMatcher[];
  actions?: PolicyMatcher[];
  environments?: PolicyMatcher[];
};

export interface PolicyMatcher {
  attribute: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'greater_than' | 'less_than' | 'in' | 'not_in' | 'regex' | 'exists' | 'not_exists';
  value: any;
}

export interface PolicyCondition {
  attribute: string;
  operator: PolicyMatcher['operator'];
  value: any;
  description?: string;
}

export interface PolicyRule {
  id: string;
  name: string;
  description?: string;
  effect: PolicyEffect;
  target: PolicyTarget;
  condition?: PolicyCondition[];
  priority: number;
  enabled: boolean;
}

export interface Policy {
  id: string;
  name: string;
  description?: string;
  tenantId: string;
  version: string;
  rules: PolicyRule[];
  metadata: {
    createdBy: string;
    createdAt: string;
    updatedBy: string;
    updatedAt: string;
    tags: string[];
  };
  enabled: boolean;
}

export interface PolicySet {
  id: string;
  name: string;
  description?: string;
  tenantId: string;
  policies: string[]; // Policy IDs
  combiningAlgorithm: 'deny_overrides' | 'permit_overrides' | 'first_applicable' | 'only_one_applicable';
  metadata: {
    createdBy: string;
    createdAt: string;
    updatedBy: string;
    updatedAt: string;
  };
  enabled: boolean;
}

export interface AccessDecision {
  decision: 'permit' | 'deny' | 'not_applicable' | 'indeterminate';
  obligations?: Obligation[];
  advice?: Advice[];
  reason: string;
  appliedPolicies: string[];
  evaluationTime: number;
  traceId: string;
}

export interface Obligation {
  id: string;
  type: 'audit_log' | 'notify' | 'rate_limit' | 'expire_after' | 'require_approval';
  parameters: Record<string, any>;
}

export interface Advice {
  id: string;
  type: 'warning' | 'info' | 'recommendation';
  message: string;
  parameters?: Record<string, any>;
}

export interface PolicyEvaluationContext {
  request: AccessRequest;
  policies: Policy[];
  obligations: Obligation[];
  advice: Advice[];
  traceId: string;
}

export interface AttributeProvider {
  name: string;
  type: 'static' | 'dynamic' | 'external';
  getAttributes(subject: Subject, resource: Resource, environment: Environment): Promise<Record<string, any>>;
}

export interface PolicyCombiningAlgorithm {
  name: string;
  combine(decisions: AccessDecision[]): AccessDecision;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  traceId: string;
  tenantId: string;
  
  request: AccessRequest;
  decision: AccessDecision;
  
  // Performance metrics
  evaluationTime: number;
  policiesEvaluated: number;
  
  // Security context
  ipAddress?: string;
  userAgent?: string;
  riskScore?: number;
}