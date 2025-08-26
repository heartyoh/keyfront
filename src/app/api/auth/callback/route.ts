import { NextRequest, NextResponse } from 'next/server';
import { keycloakService } from '@/services/keycloak';
import { redisService } from '@/services/redis';
import { v4 as uuidv4 } from 'uuid';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    if (error) {
      console.error('OAuth error:', error);
      return NextResponse.redirect(
        `${process.env.KC_LOGOUT_REDIRECT_URI || 'http://localhost:3000'}?error=${error}`
      );
    }

    if (!code || !state) {
      return NextResponse.redirect(
        `${process.env.KC_LOGOUT_REDIRECT_URI || 'http://localhost:3000'}?error=missing_params`
      );
    }

    // Initialize Keycloak service if not already done
    await keycloakService.initialize();

    // Exchange authorization code for tokens
    const tokenResponse = await keycloakService.handleCallback(code, state);

    // Create user session
    const userSession = await keycloakService.createUserSession(
      tokenResponse.access_token,
      tokenResponse.refresh_token,
      tokenResponse.id_token
    );

    // Generate session ID
    const sessionId = uuidv4();

    // Store session in Redis
    await redisService.setSession(sessionId, userSession, 3600); // 1 hour TTL

    // Set session cookie
    const response = NextResponse.redirect(
      process.env.KC_LOGOUT_REDIRECT_URI || 'http://localhost:3000'
    );

    const cookieName = process.env.SESSION_COOKIE_NAME || 'keyfront.sid';
    response.cookies.set(cookieName, sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 3600, // 1 hour
      path: '/',
    });

    // Clear CSRF cookie
    response.cookies.delete('keyfront.csrf');

    return response;
  } catch (error) {
    console.error('Callback error:', error);
    
    return NextResponse.redirect(
      `${process.env.KC_LOGOUT_REDIRECT_URI || 'http://localhost:3000'}?error=callback_failed`
    );
  }
}
