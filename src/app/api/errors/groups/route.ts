import { NextRequest, NextResponse } from 'next/server';
import { withSession, requireRole, AuthenticatedRequest } from '@/middleware/session';
import { errorTracker } from '@/services/error-tracking';
import { generateTraceId } from '@/lib/tracing';
import { z } from 'zod';

const ErrorGroupsQuerySchema = z.object({
  tenantId: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  resolved: z.coerce.boolean().optional(),
});

const ResolveGroupSchema = z.object({
  fingerprint: z.string().min(1),
});

/**
 * Get error groups
 * GET /api/errors/groups
 */
async function getHandler(request: AuthenticatedRequest) {
  const traceId = generateTraceId();

  try {
    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const query = ErrorGroupsQuerySchema.parse(searchParams);

    // Determine tenant context
    const tenantId = query.tenantId || request.user!.tenantId;
    
    // Admin can access any tenant, regular users only their own
    const isAdmin = request.user!.roles.includes('admin');
    if (!isAdmin && tenantId !== request.user!.tenantId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Access denied to this tenant\'s error groups',
            traceId,
          },
        },
        { status: 403 }
      );
    }

    let groups = await errorTracker.getErrorGroups(tenantId, query.limit);
    
    // Apply resolved filter if specified
    if (query.resolved !== undefined) {
      groups = groups.filter(group => group.resolved === query.resolved);
    }

    return NextResponse.json({
      success: true,
      data: {
        groups,
        total: groups.length,
        filters: {
          tenantId,
          limit: query.limit,
          resolved: query.resolved,
        },
      },
      traceId,
    });
  } catch (error) {
    console.error('Error groups API error:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
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
          code: 'ERROR_GROUPS_ERROR',
          message: 'Failed to retrieve error groups',
          traceId,
        },
      },
      { status: 500 }
    );
  }
}

/**
 * Resolve error group
 * PUT /api/errors/groups
 */
async function putHandler(request: AuthenticatedRequest) {
  const traceId = generateTraceId();

  try {
    const body = await request.json();
    const validatedData = ResolveGroupSchema.parse(body);

    const success = await errorTracker.resolveErrorGroup(
      validatedData.fingerprint,
      request.user!.sub
    );

    if (!success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'ERROR_GROUP_NOT_FOUND',
            message: 'Error group not found',
            traceId,
          },
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        message: 'Error group resolved successfully',
        fingerprint: validatedData.fingerprint,
        resolvedBy: request.user!.sub,
        resolvedAt: new Date().toISOString(),
      },
      traceId,
    });
  } catch (error) {
    console.error('Error group resolve API error:', error);
    
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
          code: 'ERROR_GROUP_RESOLVE_ERROR',
          message: 'Failed to resolve error group',
          traceId,
        },
      },
      { status: 500 }
    );
  }
}

export const GET = withSession(requireRole(['admin', 'user'])(getHandler));
export const PUT = withSession(requireRole(['admin', 'user'])(putHandler));