import { NextRequest, NextResponse } from 'next/server';
import { withSession, requireRole, AuthenticatedRequest } from '@/middleware/session';
import { tokenExchangeService } from '@/services/token-exchange';
import { generateTraceId } from '@/lib/tracing';
import { z } from 'zod';

const AllowedSubjectsSchema = z.object({
  users: z.array(z.string()).optional(),
  services: z.array(z.string()).optional(),
  roles: z.array(z.string()).optional(),
  patterns: z.array(z.string()).optional(),
});

const ScopePolicySchema = z.object({
  allowed_scopes: z.array(z.string()).optional(),
  required_scopes: z.array(z.string()).optional(),
  deny_scopes: z.array(z.string()).optional(),
  inherit_from_subject: z.boolean().default(true),
  downscope_only: z.boolean().default(true),
});

const TokenLifetimeSchema = z.object({
  max_expires_in: z.number().positive().optional(),
  default_expires_in: z.number().positive().default(3600), // 1 hour
});

const ExchangeLimitsSchema = z.object({
  max_exchanges_per_token: z.number().positive().optional(),
  max_delegation_depth: z.number().positive().default(5),
});

const ConditionsSchema = z.object({
  require_actor_token: z.boolean().default(false),
  allowed_token_types: z.array(z.enum([
    'urn:ietf:params:oauth:token-type:access_token',
    'urn:ietf:params:oauth:token-type:refresh_token',
    'urn:ietf:params:oauth:token-type:id_token',
    'urn:ietf:params:oauth:token-type:saml2',
    'urn:ietf:params:oauth:token-type:jwt'
  ])).optional(),
  time_restrictions: z.object({
    business_hours_only: z.boolean().optional(),
    allowed_days: z.array(z.string()).optional(),
  }).optional(),
});

const CreatePolicySchema = z.object({
  name: z.string().min(1),
  allowed_subjects: AllowedSubjectsSchema,
  allowed_targets: AllowedSubjectsSchema.optional(),
  allowed_audiences: z.array(z.string()).optional(),
  allowed_resources: z.array(z.string()).optional(),
  scope_policy: ScopePolicySchema,
  token_lifetime: TokenLifetimeSchema,
  exchange_limits: ExchangeLimitsSchema,
  conditions: ConditionsSchema.optional(),
  enabled: z.boolean().default(true),
  description: z.string().optional(),
});

const UpdatePolicySchema = CreatePolicySchema.partial();

/**
 * List token exchange policies
 * GET /api/token-exchange/policies
 */
async function getHandler(request: AuthenticatedRequest) {
  const traceId = generateTraceId();

  try {
    const policies = await tokenExchangeService.listPolicies(request.user!.tenantId);

    return NextResponse.json({
      success: true,
      data: {
        policies,
        total: policies.length,
      },
      traceId,
    });
  } catch (error) {
    console.error('Token exchange policies list API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'POLICIES_LIST_ERROR',
          message: 'Failed to retrieve token exchange policies',
          traceId,
        },
      },
      { status: 500 }
    );
  }
}

/**
 * Create token exchange policy
 * POST /api/token-exchange/policies
 */
async function postHandler(request: AuthenticatedRequest) {
  const traceId = generateTraceId();

  try {
    const body = await request.json();
    const validatedData = CreatePolicySchema.parse(body);

    const policy = await tokenExchangeService.createPolicy({
      ...validatedData,
      tenantId: request.user!.tenantId,
      metadata: {
        createdBy: request.user!.sub,
        createdAt: new Date().toISOString(),
        updatedBy: request.user!.sub,
        updatedAt: new Date().toISOString(),
        description: validatedData.description,
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
    console.error('Token exchange policy creation API error:', error);
    
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
          message: 'Failed to create token exchange policy',
          traceId,
        },
      },
      { status: 500 }
    );
  }
}

export const GET = withSession(requireRole(['admin'])(getHandler));
export const POST = withSession(requireRole(['admin'])(postHandler));