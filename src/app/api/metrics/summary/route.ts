import { NextRequest, NextResponse } from 'next/server';
import { metricsCollector } from '@/lib/metrics';
import { withSession, requireRole, AuthenticatedRequest } from '@/middleware/session';
import { generateTraceId } from '@/lib/tracing';

/**
 * Metrics summary endpoint (requires admin access)
 * GET /api/metrics/summary
 */
async function handler(request: AuthenticatedRequest) {
  const traceId = generateTraceId();

  try {
    const summary = metricsCollector.getMetricsSummary();
    
    return NextResponse.json({
      success: true,
      data: summary,
      traceId,
    });
  } catch (error) {
    console.error('Metrics summary error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'METRICS_SUMMARY_ERROR',
          message: 'Failed to get metrics summary',
          traceId,
        },
      },
      { status: 500 }
    );
  }
}

export const GET = withSession(requireRole(['admin'])(handler));