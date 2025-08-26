import { NextRequest, NextResponse } from 'next/server';
import { withSession, requireRole, AuthenticatedRequest } from '@/middleware/session';
import { backchannelLogoutService } from '@/services/backchannel-logout';
import { generateTraceId } from '@/lib/tracing';
import { z } from 'zod';

const LogoutInitiationSchema = z.object({
  session_id: z.string().min(1),
  user_id: z.string().min(1).optional(),
  reason: z.string().optional(),
  cascade: z.boolean().default(true), // Whether to logout related sessions
  force: z.boolean().default(false), // Force logout without waiting for confirmations
});

/**
 * Initiate back-channel logout
 * POST /api/logout/backchannel
 */
async function postHandler(request: AuthenticatedRequest) {
  const traceId = generateTraceId();

  try {
    const body = await request.json();
    const validatedData = LogoutInitiationSchema.parse(body);
    
    // Determine the user ID from session or request
    const userId = validatedData.user_id || request.user!.sub;
    const tenantId = request.user!.tenantId;
    
    // Determine the trigger based on who's making the request
    let trigger: 'user_action' | 'admin_action' | 'system_timeout' | 'security_policy' | 'external_request';
    
    if (request.user!.roles.includes('admin') && validatedData.user_id && validatedData.user_id !== request.user!.sub) {
      trigger = 'admin_action';
    } else if (validatedData.force) {
      trigger = 'security_policy';
    } else {
      trigger = 'user_action';
    }
    
    // Initiate the logout
    const logoutEvent = await backchannelLogoutService.initiateLogout(
      validatedData.session_id,
      userId,
      tenantId,
      {
        trigger,
        reason: validatedData.reason,
        traceId,
        initiator: {
          user_id: request.user!.sub,
          ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined,
          user_agent: request.headers.get('user-agent') || undefined,
        },
      }
    );

    return NextResponse.json({
      success: true,
      data: {
        logout_event_id: logoutEvent.id,
        status: logoutEvent.status,
        affected_sessions: logoutEvent.affected_sessions.length,
        notifications_sent: logoutEvent.notification_results.length,
        completion_time: logoutEvent.completion_time,
        notification_results: logoutEvent.notification_results.map(r => ({
          client_id: r.client_id,
          status: r.status,
          sent_at: r.sent_at,
          acknowledged_at: r.acknowledged_at,
        })),
      },
      traceId,
    });
  } catch (error) {
    console.error('Back-channel logout initiation error:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid logout request',
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
          code: 'LOGOUT_ERROR',
          message: 'Failed to initiate back-channel logout',
          details: error instanceof Error ? error.message : 'Unknown error',
          traceId,
        },
      },
      { status: 500 }
    );
  }
}

export const POST = withSession(requireRole(['admin', 'user'])(postHandler));