import { NextRequest, NextResponse } from 'next/server';
import { withSession, requireRole, AuthenticatedRequest } from '@/middleware/session';
import { tokenExchangeService } from '@/services/token-exchange';
import { tokenExchangePolicyTemplates } from '@/services/token-exchange-policies';
import { generateTraceId } from '@/lib/tracing';
import * as jwt from 'jsonwebtoken';

/**
 * Demo endpoint to test token exchange functionality
 * POST /api/token-exchange/demo
 */
async function postHandler(request: AuthenticatedRequest) {
  const traceId = generateTraceId();

  try {
    const body = await request.json();
    const { scenario = 'service-to-service' } = body;
    
    const jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
    const tenantId = request.user!.tenantId;
    
    // Ensure default policies exist
    await tokenExchangePolicyTemplates.initializeDefaultPolicies(tenantId, request.user!.sub);
    
    let demoResult: any = {};
    
    switch (scenario) {
      case 'service-to-service':
        demoResult = await demoServiceToService(tenantId, jwtSecret, traceId);
        break;
        
      case 'downscoping':
        demoResult = await demoDownscoping(tenantId, jwtSecret, traceId, request.user!);
        break;
        
      case 'delegation':
        demoResult = await demoDelegation(tenantId, jwtSecret, traceId, request.user!);
        break;
        
      default:
        throw new Error(`Unknown scenario: ${scenario}`);
    }

    return NextResponse.json({
      success: true,
      data: {
        scenario,
        demo: demoResult,
      },
      traceId,
    });
  } catch (error) {
    console.error('Token exchange demo error:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'DEMO_ERROR',
          message: error instanceof Error ? error.message : 'Demo failed',
          traceId,
        },
      },
      { status: 500 }
    );
  }
}

async function demoServiceToService(tenantId: string, jwtSecret: string, traceId: string) {
  // Create a service token
  const serviceToken = jwt.sign({
    iss: 'keyfront-bff',
    sub: `${tenantId}-service-gateway`,
    aud: `${tenantId}-api`,
    scope: 'service:read service:write service:execute',
    tenant_id: tenantId,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    jti: generateTraceId(),
  }, jwtSecret);
  
  // Exchange for a token scoped to a specific service
  const exchangeRequest = {
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange' as const,
    subject_token: serviceToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:access_token' as const,
    audience: `${tenantId}-service-data`,
    scope: 'service:read service:write',
  };
  
  const exchangeResponse = await tokenExchangeService.exchangeToken(
    exchangeRequest,
    { clientId: `${tenantId}-service-gateway`, tenantId },
    traceId
  );
  
  // Decode the new token to show what changed
  const decodedOriginal = jwt.decode(serviceToken) as any;
  const decodedExchanged = jwt.decode(exchangeResponse.access_token) as any;
  
  return {
    original_token: {
      sub: decodedOriginal.sub,
      aud: decodedOriginal.aud,
      scope: decodedOriginal.scope,
      exp: decodedOriginal.exp,
    },
    exchanged_token: {
      sub: decodedExchanged.sub,
      aud: decodedExchanged.aud,
      scope: decodedExchanged.scope,
      exp: decodedExchanged.exp,
      exchange_count: decodedExchanged.exchange_count,
      delegation_chain: decodedExchanged.delegation_chain,
    },
    exchange_response: {
      token_type: exchangeResponse.token_type,
      expires_in: exchangeResponse.expires_in,
      scope: exchangeResponse.scope,
    },
  };
}

async function demoDownscoping(tenantId: string, jwtSecret: string, traceId: string, user: any) {
  // Create a user token with broad scopes
  const userToken = jwt.sign({
    iss: 'keyfront-bff',
    sub: user.sub,
    aud: `${tenantId}-api`,
    scope: 'read:profile read:data write:data read:files write:files admin:config',
    tenant_id: tenantId,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    jti: generateTraceId(),
  }, jwtSecret);
  
  // Exchange for a token with limited scopes
  const exchangeRequest = {
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange' as const,
    subject_token: userToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:access_token' as const,
    audience: `${tenantId}-service-file`,
    scope: 'read:files write:files', // Requesting subset of original scopes
  };
  
  const exchangeResponse = await tokenExchangeService.exchangeToken(
    exchangeRequest,
    { clientId: user.sub, tenantId },
    traceId
  );
  
  const decodedOriginal = jwt.decode(userToken) as any;
  const decodedExchanged = jwt.decode(exchangeResponse.access_token) as any;
  
  return {
    original_token: {
      sub: decodedOriginal.sub,
      aud: decodedOriginal.aud,
      scope: decodedOriginal.scope,
    },
    exchanged_token: {
      sub: decodedExchanged.sub,
      aud: decodedExchanged.aud,
      scope: decodedExchanged.scope,
      exchange_count: decodedExchanged.exchange_count,
    },
    scope_comparison: {
      original_scopes: decodedOriginal.scope.split(' '),
      requested_scopes: exchangeRequest.scope.split(' '),
      granted_scopes: decodedExchanged.scope.split(' '),
      removed_scopes: decodedOriginal.scope.split(' ').filter((s: string) => 
        !decodedExchanged.scope.split(' ').includes(s)
      ),
    },
  };
}

async function demoDelegation(tenantId: string, jwtSecret: string, traceId: string, user: any) {
  // Create an actor token (service acting on behalf of user)
  const actorToken = jwt.sign({
    iss: 'keyfront-bff',
    sub: `${tenantId}-service-workflow`,
    aud: `${tenantId}-api`,
    scope: 'service:access delegation',
    tenant_id: tenantId,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    jti: generateTraceId(),
  }, jwtSecret);
  
  // Create a subject token (user being impersonated)
  const subjectToken = jwt.sign({
    iss: 'keyfront-bff',
    sub: user.sub,
    aud: `${tenantId}-api`,
    scope: 'read:profile read:data write:data',
    tenant_id: tenantId,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    jti: generateTraceId(),
  }, jwtSecret);
  
  // Exchange with delegation (actor acting on behalf of subject)
  const exchangeRequest = {
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange' as const,
    subject_token: subjectToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:access_token' as const,
    actor_token: actorToken,
    actor_token_type: 'urn:ietf:params:oauth:token-type:access_token' as const,
    audience: `${tenantId}-service-data`,
    scope: 'read:data write:data delegation',
  };
  
  try {
    const exchangeResponse = await tokenExchangeService.exchangeToken(
      exchangeRequest,
      { clientId: `${tenantId}-service-workflow`, tenantId },
      traceId
    );
    
    const decodedSubject = jwt.decode(subjectToken) as any;
    const decodedActor = jwt.decode(actorToken) as any;
    const decodedExchanged = jwt.decode(exchangeResponse.access_token) as any;
    
    return {
      subject_token: {
        sub: decodedSubject.sub,
        scope: decodedSubject.scope,
      },
      actor_token: {
        sub: decodedActor.sub,
        scope: decodedActor.scope,
      },
      exchanged_token: {
        sub: decodedExchanged.sub, // Should be same as subject
        aud: decodedExchanged.aud,
        scope: decodedExchanged.scope,
        act: decodedExchanged.act, // Actor information
        delegation_chain: decodedExchanged.delegation_chain,
      },
      delegation_info: {
        actor_identity: decodedExchanged.act?.sub,
        subject_identity: decodedExchanged.sub,
        delegation_depth: decodedExchanged.delegation_chain?.length || 0,
      },
    };
  } catch (error) {
    // Delegation might be disabled by default
    return {
      error: 'Delegation failed - this is expected if delegation policies are restrictive',
      reason: error instanceof Error ? error.message : 'Unknown error',
      note: 'User delegation policy may need to be enabled and configured for your tenant',
    };
  }
}

export const POST = withSession(requireRole(['admin'])(postHandler));