import { NextRequest, NextResponse } from 'next/server';
import { withSession, AuthenticatedRequest } from '@/middleware/session';

export async function handler(request: AuthenticatedRequest): Promise<NextResponse> {
  try {
    if (!request.user) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'User not authenticated',
          },
        },
        { status: 401 }
      );
    }

    // Return user information (excluding sensitive data)
    const userInfo = {
      id: request.user.id,
      sub: request.user.sub,
      tenantId: request.user.tenantId,
      email: request.user.email,
      name: request.user.name,
      roles: request.user.roles,
      permissions: request.user.permissions,
      createdAt: request.user.createdAt,
      lastActivity: request.user.lastActivity,
    };

    return NextResponse.json({
      success: true,
      data: userInfo,
    });
  } catch (error) {
    console.error('Get user info error:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve user information',
        },
      },
      { status: 500 }
    );
  }
}

export const GET = (request: NextRequest) => withSession(request, handler);
