import { NextRequest } from 'next/server';
import { redisService } from '@/services/redis';
import { keycloakService } from '@/services/keycloak';
import { websocketService } from '@/services/websocket';
import { generateTraceId } from '@/lib/tracing';
import { auditEvents } from '@/lib/audit';

export async function GET(request: NextRequest) {
  const traceId = generateTraceId();
  
  try {
    // Check if this is a WebSocket upgrade request
    const upgrade = request.headers.get('upgrade');
    const connection = request.headers.get('connection');
    
    if (upgrade !== 'websocket' || !connection?.toLowerCase().includes('upgrade')) {
      return new Response('Expected WebSocket upgrade request', { status: 400 });
    }

    // Get session from cookie
    const cookieName = process.env.SESSION_COOKIE_NAME || 'keyfront.sid';
    const sessionId = request.cookies.get(cookieName)?.value;

    if (!sessionId) {
      await auditEvents.login(traceId, 'unknown', 'anonymous', 'deny', 'No session cookie for WebSocket');
      return new Response('Unauthorized: No session found', { status: 401 });
    }

    // Validate session
    const session = await redisService.getSession(sessionId);
    if (!session || session.expiresAt < Date.now()) {
      await auditEvents.login(traceId, session?.tenantId || 'unknown', session?.sub || 'unknown', 'deny', 'Invalid or expired session');
      return new Response('Unauthorized: Invalid session', { status: 401 });
    }

    // Check WebSocket rate limits
    const wsRateLimit = await websocketService.checkConnectionLimit(session, traceId);
    if (!wsRateLimit.allowed) {
      await auditEvents.rateLimitHit(
        traceId,
        session.tenantId,
        session.sub,
        'websocket_connection',
        { limit: wsRateLimit.limit, current: wsRateLimit.current }
      );
      return new Response('Rate limit exceeded for WebSocket connections', { 
        status: 429,
        headers: {
          'Retry-After': '60'
        }
      });
    }

    // Log successful WebSocket authentication
    await auditEvents.login(traceId, session.tenantId, session.sub, 'allow', 'WebSocket connection authorized');

    // Handle WebSocket upgrade
    const { response, websocket } = websocketService.upgrade(request);
    
    if (websocket) {
      // Set up WebSocket connection with session context
      websocketService.handleConnection(websocket, session, traceId);
    }

    return response;

  } catch (error) {
    console.error('WebSocket upgrade error:', error);
    
    return new Response('Internal Server Error', { 
      status: 500,
      headers: {
        'x-keyfront-trace-id': traceId
      }
    });
  }
}

// Handle WebSocket connection info endpoint
export async function POST(request: NextRequest) {
  const traceId = generateTraceId();
  
  try {
    // Get active WebSocket connections info
    const stats = await websocketService.getConnectionStats();
    
    return Response.json({
      success: true,
      data: stats,
      traceId,
    });

  } catch (error) {
    console.error('WebSocket info error:', error);
    
    return Response.json({
      success: false,
      error: {
        code: 'WEBSOCKET_INFO_ERROR',
        message: 'Failed to get WebSocket information',
        traceId,
      }
    }, { status: 500 });
  }
}