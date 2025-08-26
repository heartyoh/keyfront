import { NextRequest, NextResponse } from 'next/server';
import { withSession, requireRole, AuthenticatedRequest } from '@/middleware/session';
import { backchannelLogoutService } from '@/services/backchannel-logout';
import { generateTraceId } from '@/lib/tracing';
import { z } from 'zod';

const ClientRegistrationSchema = z.object({
  client_id: z.string().min(1),
  client_name: z.string().min(1),
  backchannel_logout_uri: z.string().url().optional(),
  backchannel_logout_session_required: z.boolean().default(false),
  client_secret: z.string().optional(),
  logout_notification_enabled: z.boolean().default(true),
  logout_timeout_seconds: z.number().min(5).max(300).default(30),
  trusted_client: z.boolean().default(false),
  require_logout_confirmation: z.boolean().default(true),
  enabled: z.boolean().default(true),
});

const UpdateClientSchema = ClientRegistrationSchema.partial().omit({ client_id: true });

/**
 * List registered clients
 * GET /api/logout/clients
 */
async function getHandler(request: AuthenticatedRequest) {
  const traceId = generateTraceId();

  try {
    const tenantId = request.user!.tenantId;
    
    // Get all client registrations for the tenant
    const clientKeys = await redisService.getKeysByPattern(`logout:client:*`);
    const clients = [];
    
    for (const key of clientKeys) {
      try {
        const clientData = await redisService.get(key);
        if (!clientData) continue;
        
        const client = JSON.parse(clientData);
        if (client.tenantId === tenantId) {
          // Remove sensitive data
          const { client_secret, ...clientInfo } = client;
          clients.push(clientInfo);
        }
      } catch (error) {
        console.error(`Failed to parse client from key ${key}:`, error);
      }
    }
    
    // Sort by creation date
    clients.sort((a, b) => new Date(b.metadata.createdAt).getTime() - new Date(a.metadata.createdAt).getTime());

    return NextResponse.json({
      success: true,
      data: {
        clients,
        total: clients.length,
      },
      traceId,
    });
  } catch (error) {
    console.error('Logout clients list API error:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'CLIENTS_LIST_ERROR',
          message: 'Failed to retrieve client registrations',
          traceId,
        },
      },
      { status: 500 }
    );
  }
}

/**
 * Register a new client
 * POST /api/logout/clients
 */
async function postHandler(request: AuthenticatedRequest) {
  const traceId = generateTraceId();

  try {
    const body = await request.json();
    const validatedData = ClientRegistrationSchema.parse(body);
    
    const client = await backchannelLogoutService.registerClient({
      ...validatedData,
      tenantId: request.user!.tenantId,
      metadata: {
        createdBy: request.user!.sub,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
    
    // Remove sensitive data from response
    const { client_secret, ...clientResponse } = client;

    return NextResponse.json({
      success: true,
      data: {
        client: clientResponse,
      },
      traceId,
    }, { status: 201 });
  } catch (error) {
    console.error('Client registration API error:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid client registration data',
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
          code: 'CLIENT_REGISTER_ERROR',
          message: 'Failed to register client',
          traceId,
        },
      },
      { status: 500 }
    );
  }
}

export const GET = withSession(requireRole(['admin'])(getHandler));
export const POST = withSession(requireRole(['admin'])(postHandler));