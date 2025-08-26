import { NextRequest, NextResponse } from 'next/server';
import { withSession, requireRole, AuthenticatedRequest } from '@/middleware/session';
import { abacEngine } from '@/services/abac';
import { generateTraceId } from '@/lib/tracing';
import { z } from 'zod';

const PolicyMatcherSchema = z.object({
  attribute: z.string().min(1),
  operator: z.enum(['equals', 'not_equals', 'contains', 'not_contains', 'greater_than', 'less_than', 'in', 'not_in', 'regex', 'exists', 'not_exists']),
  value: z.any(),
});

const PolicyTargetSchema = z.object({
  subjects: z.array(PolicyMatcherSchema).optional(),
  resources: z.array(PolicyMatcherSchema).optional(),
  actions: z.array(PolicyMatcherSchema).optional(),
  environments: z.array(PolicyMatcherSchema).optional(),
});

const PolicyConditionSchema = z.object({
  attribute: z.string().min(1),
  operator: z.enum(['equals', 'not_equals', 'contains', 'not_contains', 'greater_than', 'less_than', 'in', 'not_in', 'regex', 'exists', 'not_exists']),
  value: z.any(),
  description: z.string().optional(),
});

const PolicyRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  effect: z.enum(['permit', 'deny']),
  target: PolicyTargetSchema,
  condition: z.array(PolicyConditionSchema).optional(),
  priority: z.number().min(0),
  enabled: z.boolean().default(true),
});

const CreatePolicySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string().default('1.0.0'),
  rules: z.array(PolicyRuleSchema).min(1),
  tags: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
});

const UpdatePolicySchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  version: z.string().optional(),
  rules: z.array(PolicyRuleSchema).optional(),
  tags: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});

/**
 * List ABAC policies
 * GET /api/abac/policies
 */
async function getHandler(request: AuthenticatedRequest) {
  const traceId = generateTraceId();

  try {
    const policies = await abacEngine.listPolicies(request.user!.tenantId);

    return NextResponse.json({
      success: true,
      data: {
        policies,
        total: policies.length,
      },
      traceId,
    });
  } catch (error) {
    console.error('ABAC policies list API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'POLICIES_LIST_ERROR',
          message: 'Failed to retrieve ABAC policies',
          traceId,
        },
      },
      { status: 500 }
    );
  }
}

/**
 * Create ABAC policy
 * POST /api/abac/policies
 */
async function postHandler(request: AuthenticatedRequest) {
  const traceId = generateTraceId();

  try {
    const body = await request.json();
    const validatedData = CreatePolicySchema.parse(body);

    const policy = await abacEngine.createPolicy({
      ...validatedData,
      tenantId: request.user!.tenantId,
      metadata: {
        createdBy: request.user!.sub,
        createdAt: new Date().toISOString(),
        updatedBy: request.user!.sub,
        updatedAt: new Date().toISOString(),
        tags: validatedData.tags,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        policy,
      },
      traceId,
    }, { status: 201 });
  } catch (error) {
    console.error('ABAC policy creation API error:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid policy data',
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
          code: 'POLICY_CREATE_ERROR',
          message: 'Failed to create ABAC policy',
          traceId,
        },
      },
      { status: 500 }
    );
  }
}

export const GET = withSession(requireRole(['admin'])(getHandler));
export const POST = withSession(requireRole(['admin'])(postHandler));