import { NextRequest, NextResponse } from 'next/server';
import { AuthenticatedRequest } from './session';
import { abacEngine } from '@/services/abac';
import { AccessRequest, Subject, Resource, Action, Environment } from '@/types/abac';
import { generateTraceId } from '@/lib/tracing';

export interface AbacRequest extends AuthenticatedRequest {
  abacDecision?: {
    permitted: boolean;
    reason: string;
    traceId: string;
  };
}

export interface AbacResourceDefinition {
  type: string;
  id?: string;
  attributes?: Record<string, any>;
  classification?: 'public' | 'internal' | 'confidential' | 'secret';
  ownerId?: string;
}

export interface AbacActionDefinition {
  name: string;
  type: 'read' | 'write' | 'delete' | 'execute' | 'admin';
  attributes?: Record<string, any>;
}

export function requireAbacPermission(
  resourceDef: AbacResourceDefinition | ((req: AuthenticatedRequest) => AbacResourceDefinition),
  actionDef: AbacActionDefinition | ((req: AuthenticatedRequest) => AbacActionDefinition)
) {
  return async (
    request: AuthenticatedRequest,
    handler: (req: AbacRequest) => Promise<NextResponse>
  ): Promise<NextResponse> => {
    const traceId = generateTraceId();
    
    try {
      if (!request.user) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'UNAUTHORIZED',
              message: 'User not authenticated',
              traceId,
            },
          },
          { status: 401 }
        );
      }

      // Resolve resource and action definitions
      const resource = typeof resourceDef === 'function' ? resourceDef(request) : resourceDef;
      const action = typeof actionDef === 'function' ? actionDef(request) : actionDef;

      // Create ABAC access request
      const accessRequest = await createAccessRequest(request, resource, action, traceId);

      // Evaluate access
      const decision = await abacEngine.evaluateAccess(accessRequest, traceId);

      // Create ABAC-enabled request
      const abacRequest = request as AbacRequest;
      abacRequest.abacDecision = {
        permitted: decision.decision === 'permit',
        reason: decision.reason,
        traceId: decision.traceId,
      };

      // Check if access is permitted
      if (decision.decision !== 'permit') {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'ACCESS_DENIED',
              message: decision.reason,
              traceId: decision.traceId,
            },
          },
          { status: 403 }
        );
      }

      // Process any obligations
      if (decision.obligations && decision.obligations.length > 0) {
        await processObligations(decision.obligations, accessRequest, decision);
      }

      // Add advice to response headers if present
      const response = await handler(abacRequest);
      
      if (decision.advice && decision.advice.length > 0) {
        response.headers.set('X-ABAC-Advice', JSON.stringify(decision.advice));
      }
      
      response.headers.set('X-ABAC-Decision', decision.decision);
      response.headers.set('X-ABAC-Trace-ID', decision.traceId);

      return response;
    } catch (error) {
      console.error('ABAC middleware error:', error);
      
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'ABAC_ERROR',
            message: 'Access control evaluation failed',
            traceId,
          },
        },
        { status: 500 }
      );
    }
  };
}

async function createAccessRequest(
  request: AuthenticatedRequest,
  resourceDef: AbacResourceDefinition,
  actionDef: AbacActionDefinition,
  traceId: string
): Promise<AccessRequest> {
  const user = request.user!;
  
  // Create Subject
  const subject: Subject = {
    id: user.sub,
    type: 'user',
    tenantId: user.tenantId,
    roles: user.roles,
    attributes: {
      username: user.username,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      groups: user.groups || [],
      roles: user.roles,
      tenantId: user.tenantId,
      sessionId: (request as any).sessionId,
      ...user.attributes,
    },
  };

  // Create Resource
  const resource: Resource = {
    id: resourceDef.id || `${resourceDef.type}:${traceId}`,
    type: resourceDef.type,
    tenantId: user.tenantId, // Resources are scoped to tenant
    ownerId: resourceDef.ownerId,
    attributes: {
      type: resourceDef.type,
      tenantId: user.tenantId,
      classification: resourceDef.classification || 'internal',
      ...resourceDef.attributes,
    },
    classification: resourceDef.classification,
  };

  // Create Action
  const action: Action = {
    name: actionDef.name,
    type: actionDef.type,
    attributes: {
      type: actionDef.type,
      name: actionDef.name,
      ...actionDef.attributes,
    },
  };

  // Create Environment
  const environment: Environment = {
    timestamp: new Date().toISOString(),
    ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined,
    userAgent: request.headers.get('user-agent') || undefined,
    ...getTimeContext(),
    ...await getRiskContext(request),
  };

  return {
    subject,
    resource,
    action,
    environment,
    context: {
      requestUrl: request.url,
      requestMethod: request.method,
      traceId,
    },
  };
}

function getTimeContext() {
  const now = new Date();
  const hour = now.getHours();
  const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  
  let timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  if (hour >= 6 && hour < 12) timeOfDay = 'morning';
  else if (hour >= 12 && hour < 18) timeOfDay = 'afternoon';
  else if (hour >= 18 && hour < 22) timeOfDay = 'evening';
  else timeOfDay = 'night';
  
  const isBusinessHours = hour >= 9 && hour < 17 && !['saturday', 'sunday'].includes(dayOfWeek);
  
  return {
    timeOfDay,
    dayOfWeek: dayOfWeek as any,
    isBusinessHours,
  };
}

async function getRiskContext(request: NextRequest): Promise<{ riskScore?: number }> {
  // Simple risk scoring based on request characteristics
  let riskScore = 0;
  
  const userAgent = request.headers.get('user-agent') || '';
  const ipAddress = request.headers.get('x-forwarded-for') || '';
  
  // Increase risk for suspicious user agents
  if (userAgent.toLowerCase().includes('bot') || userAgent.toLowerCase().includes('crawler')) {
    riskScore += 30;
  }
  
  // Increase risk for certain IP patterns (this is simplified)
  if (ipAddress.startsWith('10.') || ipAddress.startsWith('192.168.')) {
    riskScore -= 10; // Lower risk for internal IPs
  }
  
  // Add more sophisticated risk scoring logic here
  
  return { riskScore: Math.max(0, Math.min(100, riskScore)) };
}

async function processObligations(
  obligations: any[],
  accessRequest: AccessRequest,
  decision: any
): Promise<void> {
  for (const obligation of obligations) {
    try {
      switch (obligation.type) {
        case 'audit_log':
          // Enhanced audit logging
          console.log(`ABAC Obligation - Enhanced audit for: ${accessRequest.subject.id} accessing ${accessRequest.resource.id}`);
          break;
          
        case 'notify':
          // Send notification
          console.log(`ABAC Obligation - Notify: ${obligation.parameters.message}`);
          break;
          
        case 'rate_limit':
          // Additional rate limiting
          console.log(`ABAC Obligation - Rate limit: ${obligation.parameters.limit} requests per ${obligation.parameters.window}`);
          break;
          
        case 'expire_after':
          // Set access expiration
          console.log(`ABAC Obligation - Access expires after: ${obligation.parameters.duration}`);
          break;
          
        case 'require_approval':
          // Require additional approval
          console.log(`ABAC Obligation - Requires approval from: ${obligation.parameters.approver}`);
          break;
          
        default:
          console.log(`ABAC Obligation - Unknown type: ${obligation.type}`);
      }
    } catch (error) {
      console.error(`Failed to process obligation ${obligation.id}:`, error);
    }
  }
}

// Convenience functions for common resource types
export function documentResource(documentId: string, ownerId?: string): AbacResourceDefinition {
  return {
    type: 'document',
    id: documentId,
    ownerId,
    attributes: {
      resourceCategory: 'document',
    },
  };
}

export function apiResource(endpoint: string): AbacResourceDefinition {
  return {
    type: 'api_endpoint',
    id: endpoint,
    attributes: {
      endpoint,
      resourceCategory: 'api',
    },
  };
}

export function tenantResource(tenantId: string): AbacResourceDefinition {
  return {
    type: 'tenant',
    id: tenantId,
    attributes: {
      resourceCategory: 'tenant',
    },
  };
}

// Convenience functions for common actions
export function readAction(): AbacActionDefinition {
  return {
    name: 'read',
    type: 'read',
  };
}

export function writeAction(): AbacActionDefinition {
  return {
    name: 'write',
    type: 'write',
  };
}

export function deleteAction(): AbacActionDefinition {
  return {
    name: 'delete',
    type: 'delete',
  };
}

export function adminAction(actionName?: string): AbacActionDefinition {
  return {
    name: actionName || 'admin',
    type: 'admin',
  };
}