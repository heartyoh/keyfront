import { NextRequest, NextResponse } from 'next/server';
import { withSession, requireRole, AuthenticatedRequest } from '@/middleware/session';
import { tenantService } from '@/services/tenant';
import { generateTraceId } from '@/lib/tracing';
import { z } from 'zod';

const TenantQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  status: z.enum(['active', 'inactive', 'suspended']).optional(),
  search: z.string().optional(),
  tags: z.string().transform(str => str.split(',').filter(Boolean)).optional(),
  sortBy: z.enum(['name', 'createdAt', 'updatedAt']).default('updatedAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

const CreateTenantSchema = z.object({
  tenantId: z.string().min(1),
  name: z.string().min(1),
  corsConfig: z.object({
    origins: z.array(z.string()).optional(),
    methods: z.array(z.string()).optional(),
    allowedHeaders: z.array(z.string()).optional(),
    exposedHeaders: z.array(z.string()).optional(),
    credentials: z.boolean().optional(),
    maxAge: z.number().optional(),
  }).optional(),
  rateLimits: z.object({
    perMinute: z.number().min(1).optional(),
    perHour: z.number().min(1).optional(),
    perDay: z.number().min(1).optional(),
    burst: z.number().min(1).optional(),
  }).optional(),
  security: z.object({
    enableCsrfProtection: z.boolean().optional(),
    sessionTimeout: z.number().min(300).optional(),
    maxConcurrentSessions: z.number().min(1).optional(),
    requireSecureHeaders: z.boolean().optional(),
    enableStrictTransportSecurity: z.boolean().optional(),
  }).optional(),
  features: z.object({
    enableAuditLogging: z.boolean().optional(),
    enableMetricsCollection: z.boolean().optional(),
    enableWebSocketSupport: z.boolean().optional(),
    enableAdvancedAuth: z.boolean().optional(),
    enableCustomHeaders: z.boolean().optional(),
  }).optional(),
  tags: z.array(z.string()).optional(),
  description: z.string().optional(),
});

/**
 * List tenant configurations
 * GET /api/tenants
 */
async function getHandler(request: AuthenticatedRequest) {
  const traceId = generateTraceId();

  try {
    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const query = TenantQuerySchema.parse(searchParams);

    const result = await tenantService.listConfigurations(query);

    return NextResponse.json({
      success: true,
      data: {
        tenants: result.configs,
        pagination: {
          page: result.page,
          limit: query.limit,
          total: result.total,
          totalPages: result.totalPages,
        },
        filters: {
          status: query.status,
          search: query.search,
          tags: query.tags,
          sortBy: query.sortBy,
          sortOrder: query.sortOrder,
        },
      },
      traceId,
    });
  } catch (error) {
    console.error('Tenants list API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'TENANTS_LIST_ERROR',
          message: 'Failed to retrieve tenant configurations',
          traceId,
        },
      },
      { status: 500 }
    );
  }
}

/**
 * Create tenant configuration
 * POST /api/tenants
 */
async function postHandler(request: AuthenticatedRequest) {
  const traceId = generateTraceId();

  try {
    const body = await request.json();
    const validatedData = CreateTenantSchema.parse(body);

    // Check if tenant already exists
    const existingConfig = await tenantService.getConfiguration(validatedData.tenantId);
    if (existingConfig) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'TENANT_ALREADY_EXISTS',
            message: `Tenant configuration already exists for ${validatedData.tenantId}`,
            traceId,
          },
        },
        { status: 409 }
      );
    }

    const config = await tenantService.createConfiguration(
      validatedData.tenantId,
      request.user!.sub,
      validatedData
    );

    return NextResponse.json({
      success: true,
      data: {
        tenant: config,
      },
      traceId,
    }, { status: 201 });
  } catch (error) {
    console.error('Tenant creation API error:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
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
          code: 'TENANT_CREATE_ERROR',
          message: 'Failed to create tenant configuration',
          traceId,
        },
      },
      { status: 500 }
    );
  }
}

export const GET = withSession(requireRole(['admin'])(getHandler));
export const POST = withSession(requireRole(['admin'])(postHandler));