import { NextRequest, NextResponse } from 'next/server';
import { withSession, requireRole, AuthenticatedRequest } from '@/middleware/session';
import { tenantService } from '@/services/tenant';
import { generateTraceId } from '@/lib/tracing';
import { z } from 'zod';

const UsageQuerySchema = z.object({
  days: z.coerce.number().min(1).max(30).default(7),
});

/**
 * Get tenant usage statistics
 * GET /api/tenants/[tenantId]/usage
 */
async function handler(
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
            message: 'Access denied to this tenant usage data',
            traceId,
          },
        },
        { status: 403 }
      );
    }

    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const query = UsageQuerySchema.parse(searchParams);

    const usageStats = await tenantService.getUsageStats(tenantId, query.days);

    // Calculate totals
    const totals = usageStats.reduce((acc, stat) => ({
      requests: {
        total: acc.requests.total + stat.requests.total,
        successful: acc.requests.successful + stat.requests.successful,
        failed: acc.requests.failed + stat.requests.failed,
        rateLimited: acc.requests.rateLimited + stat.requests.rateLimited,
      },
      bandwidth: {
        inbound: acc.bandwidth.inbound + stat.bandwidth.inbound,
        outbound: acc.bandwidth.outbound + stat.bandwidth.outbound,
      },
      sessions: {
        total: acc.sessions.total + stat.sessions.total,
        peak: Math.max(acc.sessions.peak, stat.sessions.peak),
      },
      errors: {
        total: acc.errors.total + stat.errors.total,
      },
    }), {
      requests: { total: 0, successful: 0, failed: 0, rateLimited: 0 },
      bandwidth: { inbound: 0, outbound: 0 },
      sessions: { total: 0, peak: 0 },
      errors: { total: 0 },
    });

    // Calculate averages
    const averages = {
      requestsPerDay: usageStats.length > 0 ? totals.requests.total / usageStats.length : 0,
      successRate: totals.requests.total > 0 ? 
        (totals.requests.successful / totals.requests.total) * 100 : 0,
      errorRate: totals.requests.total > 0 ? 
        (totals.requests.failed / totals.requests.total) * 100 : 0,
      rateLimitRate: totals.requests.total > 0 ? 
        (totals.requests.rateLimited / totals.requests.total) * 100 : 0,
    };

    return NextResponse.json({
      success: true,
      data: {
        tenantId,
        period: {
          start: usageStats.length > 0 ? usageStats[0].period.start : null,
          end: usageStats.length > 0 ? usageStats[usageStats.length - 1].period.end : null,
          days: query.days,
        },
        summary: {
          totals,
          averages,
        },
        dailyStats: usageStats,
      },
      traceId,
    });
  } catch (error) {
    console.error('Tenant usage API error:', error);
    
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
          code: 'TENANT_USAGE_ERROR',
          message: 'Failed to retrieve tenant usage statistics',
          traceId,
        },
      },
      { status: 500 }
    );
  }
}

export const GET = withSession(requireRole(['admin', 'user'])(handler));