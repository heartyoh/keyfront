import { NextRequest, NextResponse } from 'next/server';
import { tokenExchangeService } from '@/services/token-exchange';
import { TokenExchangeRequest } from '@/types/token-exchange';
import { generateTraceId } from '@/lib/tracing';
import { z } from 'zod';

const TokenExchangeSchema = z.object({
  grant_type: z.literal('urn:ietf:params:oauth:grant-type:token-exchange'),
  subject_token: z.string().min(1),
  subject_token_type: z.enum([
    'urn:ietf:params:oauth:token-type:access_token',
    'urn:ietf:params:oauth:token-type:refresh_token',
    'urn:ietf:params:oauth:token-type:id_token',
    'urn:ietf:params:oauth:token-type:saml2',
    'urn:ietf:params:oauth:token-type:jwt'
  ]),
  actor_token: z.string().optional(),
  actor_token_type: z.enum([
    'urn:ietf:params:oauth:token-type:access_token',
    'urn:ietf:params:oauth:token-type:refresh_token',
    'urn:ietf:params:oauth:token-type:id_token',
    'urn:ietf:params:oauth:token-type:saml2',
    'urn:ietf:params:oauth:token-type:jwt'
  ]).optional(),
  requested_token_type: z.enum([
    'urn:ietf:params:oauth:token-type:access_token',
    'urn:ietf:params:oauth:token-type:refresh_token',
    'urn:ietf:params:oauth:token-type:id_token',
    'urn:ietf:params:oauth:token-type:saml2',
    'urn:ietf:params:oauth:token-type:jwt'
  ]).optional(),
  audience: z.union([z.string(), z.array(z.string())]).optional(),
  scope: z.string().optional(),
  resource: z.union([z.string(), z.array(z.string())]).optional(),
});

/**
 * OAuth 2.0 Token Exchange (RFC 8693)
 * POST /api/token/exchange
 */
async function postHandler(request: NextRequest) {
  const traceId = generateTraceId();
  
  try {
    // Parse form data or JSON body
    const contentType = request.headers.get('content-type') || '';
    let body: any;
    
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await request.formData();
      body = Object.fromEntries(formData.entries());
      
      // Handle arrays in form data
      if (body.audience && body.audience.includes(',')) {
        body.audience = body.audience.split(',');
      }
      if (body.resource && body.resource.includes(',')) {
        body.resource = body.resource.split(',');
      }
    } else {
      body = await request.json();
    }
    
    // Validate request
    const validatedRequest = TokenExchangeSchema.parse(body) as TokenExchangeRequest;
    
    // Extract client credentials from Authorization header or body
    const authHeader = request.headers.get('authorization');
    let clientId: string | undefined;
    let clientSecret: string | undefined;
    
    if (authHeader?.startsWith('Basic ')) {
      const credentials = Buffer.from(authHeader.slice(6), 'base64').toString();
      [clientId, clientSecret] = credentials.split(':');
    } else if (body.client_id) {
      clientId = body.client_id;
      clientSecret = body.client_secret;
    }
    
    if (!clientId) {
      return NextResponse.json(
        {
          error: 'invalid_client',
          error_description: 'Client authentication required',
        },
        { 
          status: 401,
          headers: {
            'WWW-Authenticate': 'Basic realm="Token Exchange"',
            'x-trace-id': traceId,
          }
        }
      );
    }
    
    // For demonstration, we'll use a simple tenant extraction from client_id
    // In production, you'd validate the client credentials against your service registry
    const tenantId = extractTenantFromClientId(clientId);
    
    if (!tenantId) {
      return NextResponse.json(
        {
          error: 'invalid_client',
          error_description: 'Invalid client identifier',
        },
        { 
          status: 401,
          headers: {
            'x-trace-id': traceId,
          }
        }
      );
    }
    
    // Perform token exchange
    const requesterInfo = {
      clientId,
      tenantId,
    };
    
    const exchangeResponse = await tokenExchangeService.exchangeToken(
      validatedRequest,
      requesterInfo,
      traceId
    );
    
    return NextResponse.json(exchangeResponse, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'Pragma': 'no-cache',
        'x-trace-id': traceId,
      },
    });
    
  } catch (error) {
    console.error('Token exchange error:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'invalid_request',
          error_description: 'Invalid token exchange request',
          details: error.errors,
        },
        { 
          status: 400,
          headers: {
            'x-trace-id': traceId,
          }
        }
      );
    }
    
    // Map common errors to OAuth error codes
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    if (errorMessage.includes('Invalid or expired subject token')) {
      return NextResponse.json(
        {
          error: 'invalid_grant',
          error_description: 'The provided subject token is invalid or expired',
        },
        { 
          status: 400,
          headers: {
            'x-trace-id': traceId,
          }
        }
      );
    }
    
    if (errorMessage.includes('No applicable token exchange policy found')) {
      return NextResponse.json(
        {
          error: 'invalid_request',
          error_description: 'Token exchange not allowed for this client',
        },
        { 
          status: 400,
          headers: {
            'x-trace-id': traceId,
          }
        }
      );
    }
    
    if (errorMessage.includes('denied by policy')) {
      return NextResponse.json(
        {
          error: 'access_denied',
          error_description: errorMessage,
        },
        { 
          status: 403,
          headers: {
            'x-trace-id': traceId,
          }
        }
      );
    }
    
    return NextResponse.json(
      {
        error: 'server_error',
        error_description: 'Internal server error during token exchange',
      },
      { 
        status: 500,
        headers: {
          'x-trace-id': traceId,
        }
      }
    );
  }
}

function extractTenantFromClientId(clientId: string): string | null {
  // Simple extraction logic - in production, you'd look this up in your service registry
  // Format: {tenantId}-service-{serviceName} or just {tenantId}
  
  if (clientId.includes('-service-')) {
    return clientId.split('-service-')[0];
  }
  
  // If it's a UUID-like string, assume it's the tenant ID
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) {
    return clientId;
  }
  
  // Default tenant for demo purposes
  return 'default-tenant';
}

export const POST = postHandler;