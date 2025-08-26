import { NextRequest, NextResponse } from 'next/server';
import { keycloakService } from '@/services/keycloak';
import { redisService } from '@/services/redis';
import { v4 as uuidv4 } from 'uuid';

export async function GET(request: NextRequest) {
  try {
    // Initialize Keycloak service if not already done
    await keycloakService.initialize();

    // Generate CSRF token for this session
    const csrfToken = uuidv4();
    const sessionId = uuidv4();

    // Store CSRF token in Redis
    await redisService.setCSRFToken(sessionId, csrfToken);

    // Generate authorization URL
    const authUrl = keycloakService.generateAuthorizationUrl(sessionId);

    // Set CSRF token in cookie
    const response = NextResponse.redirect(authUrl);
    response.cookies.set('keyfront.csrf', csrfToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 300, // 5 minutes
    });

    return response;
  } catch (error) {
    console.error('Login error:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'LOGIN_FAILED',
          message: 'Failed to initiate login process',
        },
      },
      { status: 500 }
    );
  }
}
