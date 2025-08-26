import { NextRequest, NextResponse } from 'next/server';
import { withSession, AuthenticatedRequest } from '@/middleware/session';
import { requireAbacPermission, tenantResource, readAction, writeAction, adminAction } from '@/middleware/abac';
import { generateTraceId } from '@/lib/tracing';

/**
 * Demo endpoint showing ABAC integration
 * GET /api/abac/demo - Read tenant information (requires read permission)
 */
async function getHandler(request: AuthenticatedRequest) {
  const traceId = generateTraceId();

  return NextResponse.json({
    success: true,
    data: {
      message: 'ABAC read access granted',
      tenantId: request.user!.tenantId,
      userId: request.user!.sub,
      timestamp: new Date().toISOString(),
    },
    traceId,
  });
}

/**
 * Demo endpoint showing ABAC integration
 * POST /api/abac/demo - Create tenant data (requires write permission)
 */
async function postHandler(request: AuthenticatedRequest) {
  const traceId = generateTraceId();

  const body = await request.json();

  return NextResponse.json({
    success: true,
    data: {
      message: 'ABAC write access granted',
      tenantId: request.user!.tenantId,
      userId: request.user!.sub,
      data: body,
      timestamp: new Date().toISOString(),
    },
    traceId,
  });
}

/**
 * Demo endpoint showing ABAC integration
 * DELETE /api/abac/demo - Delete tenant data (requires admin permission)
 */
async function deleteHandler(request: AuthenticatedRequest) {
  const traceId = generateTraceId();

  return NextResponse.json({
    success: true,
    data: {
      message: 'ABAC admin access granted',
      tenantId: request.user!.tenantId,
      userId: request.user!.sub,
      action: 'delete',
      timestamp: new Date().toISOString(),
    },
    traceId,
  });
}

// Apply ABAC middleware with different permission requirements for each method
export const GET = withSession(
  requireAbacPermission(
    (req) => tenantResource(req.user!.tenantId),
    () => readAction()
  )(getHandler)
);

export const POST = withSession(
  requireAbacPermission(
    (req) => tenantResource(req.user!.tenantId),
    () => writeAction()
  )(postHandler)
);

export const DELETE = withSession(
  requireAbacPermission(
    (req) => tenantResource(req.user!.tenantId),
    () => adminAction('delete')
  )(deleteHandler)
);