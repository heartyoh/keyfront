import { NextRequest, NextResponse } from 'next/server';
import { globalCsrf } from '@/lib/csrf';
import { withSession, AuthenticatedRequest, requireRole } from '@/middleware/session';
import { generateTraceId } from '@/lib/tracing';

async function handler(request: AuthenticatedRequest): Promise<NextResponse> {
  const traceId = generateTraceId();

  try {
    const sessionId = request.sessionId;
    const searchParams = request.nextUrl.searchParams;
    const includeGlobal = searchParams.get('global') === 'true';

    // Get session-specific stats
    const sessionStats = await globalCsrf.getTokenStats(sessionId!);
    
    let globalStats;
    if (includeGlobal) {
      // Only admins can see global stats
      if (!request.user?.roles.includes('admin')) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'INSUFFICIENT_PERMISSIONS',
              message: 'Admin role required for global statistics',
              traceId,
            },
          },
          { status: 403 }
        );
      }
      globalStats = await globalCsrf.getTokenStats();
    }

    // Clean up expired tokens
    const cleanedUp = await globalCsrf.cleanupExpiredTokens(sessionId!);

    return NextResponse.json({
      success: true,
      data: {
        session: {
          sessionId: sessionId!,
          ...sessionStats,
          cleanedUpTokens: cleanedUp,
        },
        global: globalStats,
        timestamp: new Date().toISOString(),
      },
      traceId,
    });
  } catch (error) {
    console.error('CSRF stats API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'CSRF_STATS_ERROR',
          message: 'Failed to get CSRF statistics',
          traceId,
        },
      },
      { status: 500 }
    );
  }
}

export const GET = withSession(handler);