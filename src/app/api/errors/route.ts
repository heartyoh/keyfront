import { NextRequest, NextResponse } from 'next/server';
import { withSession, requireRole, AuthenticatedRequest } from '@/middleware/session';
import { errorTracker } from '@/services/error-tracking';
import { generateTraceId } from '@/lib/tracing';
import { z } from 'zod';

const ErrorQuerySchema = z.object({
  tenantId: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  type: z.string().optional(),
  resolved: z.coerce.boolean().optional(),
  limit: z.coerce.number().min(1).max(1000).default(100),
});

const RecordErrorSchema = z.object({
  message: z.string().min(1),
  stack: z.string().optional(),
  type: z.string().min(1),
  severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  
  context: z.object({
    method: z.string().optional(),
    url: z.string().optional(),
    userAgent: z.string().optional(),
    ip: z.string().optional(),
    sessionId: z.string().optional(),
    route: z.string().optional(),
    statusCode: z.number().optional(),
  }).default({}),
  
  tags: z.array(z.string()).default([]),
});

/**
 * Get errors with filtering
 * GET /api/errors
 */
async function getHandler(request: AuthenticatedRequest) {
  const traceId = generateTraceId();

  try {
    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const query = ErrorQuerySchema.parse(searchParams);

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
            message: 'Access denied to this tenant\'s error data',
            traceId,
          },
        },
        { status: 403 }
      );
    }

    // Default time range to last 24 hours if not specified
    const endTime = query.endTime || new Date().toISOString();
    const startTime = query.startTime || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const errors = await errorTracker.getErrorsInTimeRange(tenantId, startTime, endTime);
    
    // Apply additional filters
    let filteredErrors = errors;
    
    if (query.severity) {
      filteredErrors = filteredErrors.filter(error => error.severity === query.severity);
    }
    
    if (query.type) {
      filteredErrors = filteredErrors.filter(error => error.type === query.type);
    }
    
    if (query.resolved !== undefined) {
      filteredErrors = filteredErrors.filter(error => error.resolved === query.resolved);
    }
    
    // Apply limit
    const limitedErrors = filteredErrors.slice(0, query.limit);

    return NextResponse.json({
      success: true,
      data: {
        errors: limitedErrors,
        total: filteredErrors.length,
        filters: {
          tenantId,
          startTime,
          endTime,
          severity: query.severity,
          type: query.type,
          resolved: query.resolved,
          limit: query.limit,
        },
      },
      traceId,
    });
  } catch (error) {
    console.error('Errors list API error:', error);
    
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
          code: 'ERRORS_LIST_ERROR',
          message: 'Failed to retrieve errors',
          traceId,
        },
      },
      { status: 500 }
    );
  }
}

/**
 * Record a new error
 * POST /api/errors
 */
async function postHandler(request: AuthenticatedRequest) {
  const traceId = generateTraceId();

  try {
    const body = await request.json();
    const validatedData = RecordErrorSchema.parse(body);

    const error = await errorTracker.recordError({
      ...validatedData,
      traceId,
      tenantId: request.user!.tenantId,
      userId: request.user!.sub,
    });

    return NextResponse.json({
      success: true,
      data: {
        error,
      },
      traceId,
    }, { status: 201 });
  } catch (error) {
    console.error('Error recording API error:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid error data',
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
          code: 'ERROR_RECORD_ERROR',
          message: 'Failed to record error',
          traceId,
        },
      },
      { status: 500 }
    );
  }
}

export const GET = withSession(requireRole(['admin', 'user'])(getHandler));
export const POST = withSession(requireRole(['admin', 'user'])(postHandler));