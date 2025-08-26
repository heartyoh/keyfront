import { NextRequest, NextResponse } from 'next/server';
import { withSession, requireRole, AuthenticatedRequest } from '@/middleware/session';
import { abacEngine } from '@/services/abac';
import { AccessRequest, Subject, Resource, Action, Environment } from '@/types/abac';
import { generateTraceId } from '@/lib/tracing';
import { z } from 'zod';

const EvaluateAccessSchema = z.object({
  resource: z.object({
    type: z.string().min(1),
    id: z.string().optional(),
    attributes: z.record(z.any()).default({}),
    classification: z.enum(['public', 'internal', 'confidential', 'secret']).optional(),
    ownerId: z.string().optional(),
  }),
  action: z.object({
    name: z.string().min(1),
    type: z.enum(['read', 'write', 'delete', 'execute', 'admin']),
    attributes: z.record(z.any()).default({}),
  }),
  environment: z.object({
    ipAddress: z.string().optional(),
    userAgent: z.string().optional(),
    location: z.object({
      country: z.string().optional(),
      region: z.string().optional(),
      city: z.string().optional(),
    }).optional(),
    riskScore: z.number().min(0).max(100).optional(),
    customAttributes: z.record(z.any()).default({}),
  }).default({}),
  context: z.record(z.any()).default({}),
});

/**
 * Evaluate ABAC access request
 * POST /api/abac/evaluate
 */
async function postHandler(request: AuthenticatedRequest) {
  const traceId = generateTraceId();

  try {
    const body = await request.json();
    const validatedData = EvaluateAccessSchema.parse(body);

    // Create Subject from authenticated user
    const subject: Subject = {
      id: request.user!.sub,
      type: 'user',
      tenantId: request.user!.tenantId,
      roles: request.user!.roles,
      attributes: {
        username: request.user!.username,
        email: request.user!.email,
        firstName: request.user!.firstName,
        lastName: request.user!.lastName,
        groups: request.user!.groups || [],
        roles: request.user!.roles,
        tenantId: request.user!.tenantId,
        ...request.user!.attributes,
      },
    };

    // Create Resource
    const resource: Resource = {
      id: validatedData.resource.id || `${validatedData.resource.type}:${traceId}`,
      type: validatedData.resource.type,
      tenantId: request.user!.tenantId,
      ownerId: validatedData.resource.ownerId,
      attributes: {
        type: validatedData.resource.type,
        tenantId: request.user!.tenantId,
        classification: validatedData.resource.classification || 'internal',
        ...validatedData.resource.attributes,
      },
      classification: validatedData.resource.classification,
    };

    // Create Action
    const action: Action = {
      name: validatedData.action.name,
      type: validatedData.action.type,
      attributes: {
        type: validatedData.action.type,
        name: validatedData.action.name,
        ...validatedData.action.attributes,
      },
    };

    // Create Environment
    const environment: Environment = {
      timestamp: new Date().toISOString(),
      ipAddress: validatedData.environment.ipAddress || 
                 request.headers.get('x-forwarded-for') || 
                 request.headers.get('x-real-ip') || 
                 undefined,
      userAgent: validatedData.environment.userAgent || 
                 request.headers.get('user-agent') || 
                 undefined,
      location: validatedData.environment.location,
      riskScore: validatedData.environment.riskScore,
      ...getTimeContext(),
      ...validatedData.environment.customAttributes,
    };

    // Create Access Request
    const accessRequest: AccessRequest = {
      subject,
      resource,
      action,
      environment,
      context: {
        ...validatedData.context,
        requestUrl: request.url,
        requestMethod: request.method,
        traceId,
      },
    };

    // Evaluate access
    const decision = await abacEngine.evaluateAccess(accessRequest, traceId);

    return NextResponse.json({
      success: true,
      data: {
        request: accessRequest,
        decision,
        evaluation: {
          permitted: decision.decision === 'permit',
          reason: decision.reason,
          appliedPolicies: decision.appliedPolicies,
          evaluationTime: decision.evaluationTime,
          obligations: decision.obligations || [],
          advice: decision.advice || [],
        },
      },
      traceId: decision.traceId,
    });
  } catch (error) {
    console.error('ABAC evaluation API error:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid access evaluation request',
            details: error.errors,
            traceId,
          },
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'EVALUATION_ERROR',
          message: 'Failed to evaluate access request',
          traceId,
        },
      },
      { status: 500 }
    );
  }
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

export const POST = withSession(requireRole(['admin', 'user'])(postHandler));