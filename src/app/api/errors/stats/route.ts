import { NextRequest, NextResponse } from 'next/server';
import { withSession, requireRole, AuthenticatedRequest } from '@/middleware/session';
import { errorTracker } from '@/services/error-tracking';
import { generateTraceId } from '@/lib/tracing';
import { z } from 'zod';

const ErrorStatsQuerySchema = z.object({
  tenantId: z.string().optional(),
  days: z.coerce.number().min(1).max(30).default(7),
});

/**
 * Get error statistics
 * GET /api/errors/stats
 */
async function handler(request: AuthenticatedRequest) {
  const traceId = generateTraceId();

  try {
    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const query = ErrorStatsQuerySchema.parse(searchParams);

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
            message: 'Access denied to this tenant\'s error statistics',
            traceId,
          },
        },
        { status: 403 }
      );
    }

    const stats = await errorTracker.getErrorStats(tenantId, query.days);

    return NextResponse.json({
      success: true,
      data: {
        tenantId,
        period: {
          days: query.days,
          generatedAt: new Date().toISOString(),
        },
        stats,
      },
      traceId,
    });
  } catch (error) {
    console.error('Error stats API error:', error);
    
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
          code: 'ERROR_STATS_ERROR',
          message: 'Failed to retrieve error statistics',
          traceId,
        },
      },
      { status: 500 }
    );
  }
}

export const GET = withSession(requireRole(['admin', 'user'])(handler));