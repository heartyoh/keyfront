import { NextRequest, NextResponse } from 'next/server';
import { withSession, AuthenticatedRequest } from '@/middleware/session';
import { redisService } from '@/services/redis';
import { backchannelLogoutService } from '@/services/backchannel-logout';
import { keycloakService } from '@/services/keycloak';
import { generateTraceId } from '@/lib/tracing';
import { metricsCollector } from '@/lib/metrics';
import { z } from 'zod';

const LogoutRequestSchema = z.object({
  post_logout_redirect_uri: z.string().url().optional(),
  state: z.string().optional(),
  id_token_hint: z.string().optional(),
  logout_hint: z.string().optional(),
  backchannel_logout: z.boolean().default(true), // Whether to trigger back-channel logout
});

/**
 * Enhanced logout with back-channel logout support
 * POST /api/auth/logout
 */
async function postHandler(request: AuthenticatedRequest) {
  const traceId = generateTraceId();
  const startTime = Date.now();

  try {
    const body = await request.json();
    const logoutRequest = LogoutRequestSchema.parse(body);
    
    const sessionId = (request as any).sessionId;
    const user = request.user!;
    
    // Create logout session record for back-channel logout tracking
    const logoutSession = {
      sessionId,
      userId: user.sub,
      tenantId: user.tenantId,
      createdAt: new Date(user.iat * 1000).toISOString(),
      lastActivity: new Date().toISOString(),
      expiresAt: user.exp * 1000,
      clientId: user.aud as string,
      logoutInitiated: true,
      logoutRequestedAt: new Date().toISOString(),
      deviceInfo: {
        userAgent: request.headers.get('user-agent') || undefined,
        ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined,
      },
    };
    
    // Store logout session for tracking
    await redisService.set(
      `logout:session:${sessionId}`,
      JSON.stringify(logoutSession),
      3600 // 1 hour TTL for logout tracking
    );
    
    let backchannelLogoutEvent;
    
    // Initiate back-channel logout if enabled
    if (logoutRequest.backchannel_logout) {
      try {
        backchannelLogoutEvent = await backchannelLogoutService.initiateLogout(
          sessionId,
          user.sub,
          user.tenantId,
          {
            trigger: 'user_action',
            traceId,
            initiator: {
              user_id: user.sub,
              ip_address: logoutSession.deviceInfo?.ipAddress,
              user_agent: logoutSession.deviceInfo?.userAgent,
            },
          }
        );
      } catch (error) {
        console.error('Back-channel logout failed, continuing with local logout:', error);
        // Don't fail the entire logout if back-channel logout fails
      }
    }
    
    // Perform local logout
    await redisService.deleteSession(sessionId);
    
    // Try to logout from Keycloak if we have the necessary tokens
    let keycloakLogoutUrl: string | null = null;
    
    try {
      if (user.refresh_token) {
        await keycloakService.revokeToken(user.refresh_token, 'refresh_token');
      }
      
      // Get Keycloak logout URL if redirect is requested
      if (logoutRequest.post_logout_redirect_uri) {
        keycloakLogoutUrl = await keycloakService.getLogoutUrl(
          logoutRequest.id_token_hint,
          logoutRequest.post_logout_redirect_uri,
          logoutRequest.state
        );
      }
    } catch (error) {
      console.error('Keycloak logout error:', error);
      // Don't fail local logout if Keycloak logout fails
    }
    
    // Record logout metrics
    await metricsCollector.incrementCounter(
      'user_logouts_total',
      {
        tenant_id: user.tenantId,
        backchannel_enabled: logoutRequest.backchannel_logout.toString(),
        keycloak_logout: (!!keycloakLogoutUrl).toString(),
      },
      1,
      'Total user logout requests'
    );
    
    await metricsCollector.observeHistogram(
      'logout_duration_seconds',
      (Date.now() - startTime) / 1000,
      {
        tenant_id: user.tenantId,
      },
      'Logout request duration'
    );
    
    // Prepare response
    const response: any = {
      success: true,
      data: {
        message: 'Logged out successfully',
        logout_completed: true,
        session_terminated: true,
      },
      traceId,
    };
    
    // Add back-channel logout information
    if (backchannelLogoutEvent) {
      response.data.backchannel_logout = {
        event_id: backchannelLogoutEvent.id,
        status: backchannelLogoutEvent.status,
        affected_sessions: backchannelLogoutEvent.affected_sessions.length,
        notifications_sent: backchannelLogoutEvent.notification_results.length,
        notification_failures: backchannelLogoutEvent.notification_results.filter(r => r.status === 'failed').length,
      };
    }
    
    // Add redirect URL if available
    if (keycloakLogoutUrl) {
      response.data.redirect_url = keycloakLogoutUrl;
    } else if (logoutRequest.post_logout_redirect_uri) {
      // If Keycloak logout failed but redirect was requested, use the redirect URI directly
      response.data.redirect_url = logoutRequest.post_logout_redirect_uri;
    }
    
    // Clear the session cookie
    const cookieName = process.env.SESSION_COOKIE_NAME || 'keyfront.sid';
    const responseObj = NextResponse.json(response);
    
    responseObj.cookies.set(cookieName, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0, // Expire immediately
      path: '/',
    });
    
    return responseObj;
    
  } catch (error) {
    console.error('Logout error:', error);
    
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
          message: 'Logout failed',
          details: error instanceof Error ? error.message : 'Unknown error',
          traceId,
        },
      },
      { status: 500 }
    );
  }
}

/**
 * Simple logout (GET request)
 * GET /api/auth/logout
 */
async function getHandler(request: AuthenticatedRequest) {
  const traceId = generateTraceId();
  
  try {
    const searchParams = request.nextUrl.searchParams;
    const postLogoutRedirectUri = searchParams.get('post_logout_redirect_uri');
    const state = searchParams.get('state');
    
    // Use POST handler logic
    const mockBody = {
      backchannel_logout: true,
      ...(postLogoutRedirectUri && { post_logout_redirect_uri: postLogoutRedirectUri }),
      ...(state && { state }),
    };
    
    // Create a mock request with the body
    const mockRequest = {
      ...request,
      json: async () => mockBody,
    } as AuthenticatedRequest;
    
    return await postHandler(mockRequest);
    
  } catch (error) {
    console.error('GET logout error:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'LOGOUT_ERROR',
          message: 'Logout failed',
          traceId,
        },
      },
      { status: 500 }
    );
  }
}

export const POST = withSession(postHandler);
export const GET = withSession(getHandler);