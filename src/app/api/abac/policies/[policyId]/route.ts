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

const UpdatePolicySchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  version: z.string().optional(),
  rules: z.array(PolicyRuleSchema).optional(),
  tags: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});

/**
 * Get ABAC policy by ID
 * GET /api/abac/policies/[policyId]
 */
async function getHandler(
  request: AuthenticatedRequest,
  { params }: { params: { policyId: string } }
) {
  const traceId = generateTraceId();
  const policyId = params.policyId;

  try {
    const policies = await abacEngine.listPolicies(request.user!.tenantId);
    const policy = policies.find(p => p.id === policyId);

    if (!policy) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'POLICY_NOT_FOUND',
            message: `ABAC policy not found: ${policyId}`,
            traceId,
          },
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        policy,
      },
      traceId,
    });
  } catch (error) {
    console.error('ABAC policy get API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'POLICY_GET_ERROR',
          message: 'Failed to retrieve ABAC policy',
          traceId,
        },
      },
      { status: 500 }
    );
  }
}

/**
 * Update ABAC policy
 * PUT /api/abac/policies/[policyId]
 */
async function putHandler(
  request: AuthenticatedRequest,
  { params }: { params: { policyId: string } }
) {
  const traceId = generateTraceId();
  const policyId = params.policyId;

  try {
    const body = await request.json();
    const validatedData = UpdatePolicySchema.parse(body);

    const updatedPolicy = await abacEngine.updatePolicy(
      policyId,
      request.user!.tenantId,
      {
        ...validatedData,
        metadata: {
          updatedBy: request.user!.sub,
          updatedAt: new Date().toISOString(),
        },
      }
    );

    if (!updatedPolicy) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'POLICY_NOT_FOUND',
            message: `ABAC policy not found: ${policyId}`,
            traceId,
          },
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        policy: updatedPolicy,
      },
      traceId,
    });
  } catch (error) {
    console.error('ABAC policy update API error:', error);
    
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
          code: 'POLICY_UPDATE_ERROR',
          message: 'Failed to update ABAC policy',
          traceId,
        },
      },
      { status: 500 }
    );
  }
}

/**
 * Delete ABAC policy
 * DELETE /api/abac/policies/[policyId]
 */
async function deleteHandler(
  request: AuthenticatedRequest,
  { params }: { params: { policyId: string } }
) {
  const traceId = generateTraceId();
  const policyId = params.policyId;

  try {
    const success = await abacEngine.deletePolicy(policyId, request.user!.tenantId);

    if (!success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'POLICY_NOT_FOUND',
            message: `ABAC policy not found: ${policyId}`,
            traceId,
          },
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        message: `ABAC policy deleted: ${policyId}`,
      },
      traceId,
    });
  } catch (error) {
    console.error('ABAC policy delete API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'POLICY_DELETE_ERROR',
          message: 'Failed to delete ABAC policy',
          traceId,
        },
      },
      { status: 500 }
    );
  }
}

export const GET = withSession(requireRole(['admin'])(getHandler));
export const PUT = withSession(requireRole(['admin'])(putHandler));
export const DELETE = withSession(requireRole(['admin'])(deleteHandler));