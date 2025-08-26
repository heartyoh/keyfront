import { NextRequest, NextResponse } from 'next/server';
import { withSession, requireRole, AuthenticatedRequest } from '@/middleware/session';
import { tenantService } from '@/services/tenant';
import { generateTraceId } from '@/lib/tracing';
import { z } from 'zod';

const UpdateTenantSchema = z.object({
  name: z.string().min(1).optional(),
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
    whitelistIps: z.array(z.string()).optional(),
    blacklistIps: z.array(z.string()).optional(),
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
  proxyConfig: z.object({
    baseUrl: z.string().url().optional(),
    timeout: z.number().min(1000).optional(),
    retries: z.number().min(0).optional(),
    retryDelay: z.number().min(100).optional(),
    enableCircuitBreaker: z.boolean().optional(),
    circuitBreakerThreshold: z.number().min(1).optional(),
    customHeaders: z.record(z.string()).optional(),
  }).optional(),
  notifications: z.object({
    enableSecurityAlerts: z.boolean().optional(),
    enableErrorNotifications: z.boolean().optional(),
    enableUsageAlerts: z.boolean().optional(),
    webhookUrl: z.string().url().optional(),
    emailRecipients: z.array(z.string().email()).optional(),
  }).optional(),
  status: z.enum(['active', 'inactive', 'suspended']).optional(),
  tags: z.array(z.string()).optional(),
  description: z.string().optional(),
});

/**
 * Get tenant configuration
 * GET /api/tenants/[tenantId]
 */
async function getHandler(
  request: AuthenticatedRequest,
  { params }: { params: { tenantId: string } }
) {
  const traceId = generateTraceId();
  const tenantId = params.tenantId;

  try {
    // Admin can access any tenant, regular users only their own
    const isAdmin = request.user!.roles.includes('admin');
    if (!isAdmin && request.user!.tenantId !== tenantId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Access denied to this tenant configuration',
            traceId,
          },
        },
        { status: 403 }
      );
    }

    const config = await tenantService.getConfiguration(tenantId);
    if (!config) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'TENANT_NOT_FOUND',
            message: `Tenant configuration not found for ${tenantId}`,
            traceId,
          },
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        tenant: config,
      },
      traceId,
    });
  } catch (error) {
    console.error('Tenant get API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'TENANT_GET_ERROR',
          message: 'Failed to retrieve tenant configuration',
          traceId,
        },
      },
      { status: 500 }
    );
  }
}

/**
 * Update tenant configuration
 * PUT /api/tenants/[tenantId]
 */
async function putHandler(
  request: AuthenticatedRequest,
  { params }: { params: { tenantId: string } }
) {
  const traceId = generateTraceId();
  const tenantId = params.tenantId;

  try {
    const body = await request.json();
    const validatedData = UpdateTenantSchema.parse(body);

    const config = await tenantService.updateConfiguration(
      tenantId,
      validatedData,
      request.user!.sub
    );

    if (!config) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'TENANT_NOT_FOUND',
            message: `Tenant configuration not found for ${tenantId}`,
            traceId,
          },
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        tenant: config,
      },
      traceId,
    });
  } catch (error) {
    console.error('Tenant update API error:', error);
    
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
          code: 'TENANT_UPDATE_ERROR',
          message: 'Failed to update tenant configuration',
          traceId,
        },
      },
      { status: 500 }
    );
  }
}

/**
 * Delete tenant configuration
 * DELETE /api/tenants/[tenantId]
 */
async function deleteHandler(
  request: AuthenticatedRequest,
  { params }: { params: { tenantId: string } }
) {
  const traceId = generateTraceId();
  const tenantId = params.tenantId;

  try {
    const success = await tenantService.deleteConfiguration(tenantId);

    if (!success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'TENANT_NOT_FOUND',
            message: `Tenant configuration not found for ${tenantId}`,
            traceId,
          },
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        message: `Tenant configuration deleted for ${tenantId}`,
      },
      traceId,
    });
  } catch (error) {
    console.error('Tenant delete API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'TENANT_DELETE_ERROR',
          message: 'Failed to delete tenant configuration',
          traceId,
        },
      },
      { status: 500 }
    );
  }
}

export const GET = withSession(requireRole(['admin', 'user'])(getHandler));
export const PUT = withSession(requireRole(['admin'])(putHandler));
export const DELETE = withSession(requireRole(['admin'])(deleteHandler));