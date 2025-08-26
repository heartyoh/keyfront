import { NextRequest, NextResponse } from 'next/server';
import { healthChecker } from '@/lib/health-check';
import { requireRole, withSession, AuthenticatedRequest } from '@/middleware/session';

/**
 * Detailed health check endpoint (requires admin access)
 * GET /api/health/detailed
 */
async function handler(request: AuthenticatedRequest) {
  try {
    const forceRefresh = request.nextUrl.searchParams.get('refresh') === 'true';
    const health = await healthChecker.getDetailedHealth(forceRefresh);
    
    const statusCode = health.overall.status === 'unhealthy' ? 503 : 
                      health.overall.status === 'degraded' ? 200 : 200;

    return NextResponse.json({
      success: true,
      data: health,
      timestamp: new Date().toISOString(),
    }, { status: statusCode });
  } catch (error) {
    console.error('Detailed health check error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'HEALTH_CHECK_FAILED',
          message: 'Failed to get detailed health information',
        },
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}

export const GET = withSession(requireRole(['admin'])(handler));