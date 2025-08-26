import { Policy } from '@/types/abac';
import { abacEngine } from './abac';
import { generateTraceId } from '@/lib/tracing';

export class AbacPolicyTemplates {
  
  static createBasicTenantAccessPolicy(tenantId: string, createdBy: string): Policy {
    return {
      id: generateTraceId(),
      name: 'Basic Tenant Access Policy',
      description: 'Allows users to access resources within their own tenant',
      tenantId,
      version: '1.0.0',
      rules: [
        {
          id: 'tenant-access-rule',
          name: 'Tenant Access Rule',
          description: 'Users can only access resources in their own tenant',
          effect: 'permit',
          target: {
            subjects: [
              {
                attribute: 'tenantId',
                operator: 'equals',
                value: tenantId,
              }
            ],
            resources: [
              {
                attribute: 'tenantId',
                operator: 'equals',
                value: tenantId,
              }
            ],
          },
          priority: 100,
          enabled: true,
        }
      ],
      metadata: {
        createdBy,
        createdAt: new Date().toISOString(),
        updatedBy: createdBy,
        updatedAt: new Date().toISOString(),
        tags: ['tenant', 'basic', 'isolation'],
      },
      enabled: true,
    };
  }
  
  static createRoleBasedPolicy(tenantId: string, createdBy: string): Policy {
    return {
      id: generateTraceId(),
      name: 'Role-Based Access Policy',
      description: 'Controls access based on user roles',
      tenantId,
      version: '1.0.0',
      rules: [
        {
          id: 'admin-full-access',
          name: 'Admin Full Access',
          description: 'Admins have full access to all resources',
          effect: 'permit',
          target: {
            subjects: [
              {
                attribute: 'roles',
                operator: 'contains',
                value: 'admin',
              }
            ],
          },
          priority: 200,
          enabled: true,
        },
        {
          id: 'user-read-only',
          name: 'User Read-Only Access',
          description: 'Regular users can only read resources',
          effect: 'permit',
          target: {
            subjects: [
              {
                attribute: 'roles',
                operator: 'contains',
                value: 'user',
              }
            ],
            actions: [
              {
                attribute: 'type',
                operator: 'equals',
                value: 'read',
              }
            ],
          },
          priority: 150,
          enabled: true,
        }
      ],
      metadata: {
        createdBy,
        createdAt: new Date().toISOString(),
        updatedBy: createdBy,
        updatedAt: new Date().toISOString(),
        tags: ['rbac', 'roles', 'authorization'],
      },
      enabled: true,
    };
  }
  
  static createTimeBasedPolicy(tenantId: string, createdBy: string): Policy {
    return {
      id: generateTraceId(),
      name: 'Business Hours Access Policy',
      description: 'Restricts access to business hours for sensitive operations',
      tenantId,
      version: '1.0.0',
      rules: [
        {
          id: 'business-hours-admin',
          name: 'Admin Actions During Business Hours',
          description: 'Admin actions only allowed during business hours',
          effect: 'permit',
          target: {
            actions: [
              {
                attribute: 'type',
                operator: 'equals',
                value: 'admin',
              }
            ],
          },
          condition: [
            {
              attribute: 'isBusinessHours',
              operator: 'equals',
              value: true,
              description: 'Must be during business hours',
            }
          ],
          priority: 175,
          enabled: true,
        },
        {
          id: 'after-hours-deny-admin',
          name: 'Deny Admin After Hours',
          description: 'Deny admin actions outside business hours',
          effect: 'deny',
          target: {
            actions: [
              {
                attribute: 'type',
                operator: 'equals',
                value: 'admin',
              }
            ],
          },
          condition: [
            {
              attribute: 'isBusinessHours',
              operator: 'equals',
              value: false,
              description: 'Outside business hours',
            }
          ],
          priority: 180,
          enabled: true,
        }
      ],
      metadata: {
        createdBy,
        createdAt: new Date().toISOString(),
        updatedBy: createdBy,
        updatedAt: new Date().toISOString(),
        tags: ['time-based', 'business-hours', 'security'],
      },
      enabled: true,
    };
  }
  
  static createRiskBasedPolicy(tenantId: string, createdBy: string): Policy {
    return {
      id: generateTraceId(),
      name: 'Risk-Based Access Policy',
      description: 'Controls access based on risk scores',
      tenantId,
      version: '1.0.0',
      rules: [
        {
          id: 'high-risk-deny',
          name: 'Deny High Risk Access',
          description: 'Deny access when risk score is high',
          effect: 'deny',
          target: {
            actions: [
              {
                attribute: 'type',
                operator: 'in',
                value: ['write', 'delete', 'admin'],
              }
            ],
          },
          condition: [
            {
              attribute: 'riskScore',
              operator: 'greater_than',
              value: 70,
              description: 'High risk score detected',
            }
          ],
          priority: 190,
          enabled: true,
        },
        {
          id: 'medium-risk-audit',
          name: 'Audit Medium Risk Access',
          description: 'Allow but audit medium risk access',
          effect: 'permit',
          target: {
            actions: [
              {
                attribute: 'type',
                operator: 'in',
                value: ['write', 'delete'],
              }
            ],
          },
          condition: [
            {
              attribute: 'riskScore',
              operator: 'greater_than',
              value: 40,
            },
            {
              attribute: 'riskScore',
              operator: 'less_than',
              value: 70,
            }
          ],
          priority: 160,
          enabled: true,
        }
      ],
      metadata: {
        createdBy,
        createdAt: new Date().toISOString(),
        updatedBy: createdBy,
        updatedAt: new Date().toISOString(),
        tags: ['risk-based', 'adaptive', 'security'],
      },
      enabled: true,
    };
  }
  
  static createDataClassificationPolicy(tenantId: string, createdBy: string): Policy {
    return {
      id: generateTraceId(),
      name: 'Data Classification Access Policy',
      description: 'Controls access based on data classification levels',
      tenantId,
      version: '1.0.0',
      rules: [
        {
          id: 'confidential-admin-only',
          name: 'Confidential Data Admin Only',
          description: 'Only admins can access confidential data',
          effect: 'permit',
          target: {
            subjects: [
              {
                attribute: 'roles',
                operator: 'contains',
                value: 'admin',
              }
            ],
            resources: [
              {
                attribute: 'classification',
                operator: 'in',
                value: ['confidential', 'secret'],
              }
            ],
          },
          priority: 220,
          enabled: true,
        },
        {
          id: 'confidential-deny-others',
          name: 'Deny Others Confidential Access',
          description: 'Deny non-admins access to confidential data',
          effect: 'deny',
          target: {
            subjects: [
              {
                attribute: 'roles',
                operator: 'not_contains',
                value: 'admin',
              }
            ],
            resources: [
              {
                attribute: 'classification',
                operator: 'in',
                value: ['confidential', 'secret'],
              }
            ],
          },
          priority: 210,
          enabled: true,
        },
        {
          id: 'public-read-all',
          name: 'Public Data Read Access',
          description: 'Everyone can read public data',
          effect: 'permit',
          target: {
            resources: [
              {
                attribute: 'classification',
                operator: 'equals',
                value: 'public',
              }
            ],
            actions: [
              {
                attribute: 'type',
                operator: 'equals',
                value: 'read',
              }
            ],
          },
          priority: 120,
          enabled: true,
        }
      ],
      metadata: {
        createdBy,
        createdAt: new Date().toISOString(),
        updatedBy: createdBy,
        updatedAt: new Date().toISOString(),
        tags: ['data-classification', 'security', 'access-control'],
      },
      enabled: true,
    };
  }
  
  static async initializeDefaultPolicies(tenantId: string, createdBy: string): Promise<Policy[]> {
    const policies = [
      this.createBasicTenantAccessPolicy(tenantId, createdBy),
      this.createRoleBasedPolicy(tenantId, createdBy),
      this.createTimeBasedPolicy(tenantId, createdBy),
      this.createRiskBasedPolicy(tenantId, createdBy),
      this.createDataClassificationPolicy(tenantId, createdBy),
    ];
    
    const createdPolicies: Policy[] = [];
    
    for (const policy of policies) {
      try {
        const created = await abacEngine.createPolicy(policy);
        createdPolicies.push(created);
      } catch (error) {
        console.error(`Failed to create policy ${policy.name}:`, error);
      }
    }
    
    return createdPolicies;
  }
}

export const abacPolicyTemplates = new AbacPolicyTemplates();