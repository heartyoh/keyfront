import { Issuer, Client, generators } from 'openid-client';
import { KeycloakTokenResponse, KeycloakUserInfo, UserSession } from '@/types/auth';
import { redisService } from './redis';
import { v4 as uuidv4 } from 'uuid';

export class KeycloakService {
  private issuer: Issuer | null = null;
  private client: Client | null = null;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly logoutRedirectUri: string;

  constructor() {
    this.clientId = process.env.KC_CLIENT_ID || 'keyfront-bff';
    this.clientSecret = process.env.KC_CLIENT_SECRET || '';
    this.redirectUri = process.env.KC_REDIRECT_URI || 'http://localhost:3000/api/auth/callback';
    this.logoutRedirectUri = process.env.KC_LOGOUT_REDIRECT_URI || 'http://localhost:3000/';
  }

  async initialize(): Promise<void> {
    try {
      const issuerUrl = process.env.KC_ISSUER_URL;
      if (!issuerUrl) {
        throw new Error('KC_ISSUER_URL environment variable is required');
      }

      this.issuer = await Issuer.discover(issuerUrl);
      
      this.client = new this.issuer.Client({
        client_id: this.clientId,
        client_secret: this.clientSecret || undefined,
        redirect_uris: [this.redirectUri],
        response_types: ['code'],
        token_endpoint_auth_method: this.clientSecret ? 'client_secret_basic' : 'none',
      });

      console.log('Keycloak client initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Keycloak client:', error);
      throw error;
    }
  }

  generateAuthorizationUrl(state?: string): string {
    if (!this.client) {
      throw new Error('Keycloak client not initialized');
    }

    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);
    const nonce = generators.nonce();
    const stateParam = state || generators.state();

    // Store PKCE and nonce for callback validation
    const oauthData = {
      codeVerifier,
      nonce,
      state: stateParam,
      timestamp: Date.now(),
    };

    redisService.setOAuthState(stateParam, oauthData, 300); // 5 minutes TTL

    const url = this.client.authorizationUrl({
      scope: 'openid email profile',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      nonce,
      state: stateParam,
    });

    return url;
  }

  async handleCallback(code: string, state: string): Promise<KeycloakTokenResponse> {
    if (!this.client) {
      throw new Error('Keycloak client not initialized');
    }

    // Retrieve and validate OAuth state
    const oauthData = await redisService.getOAuthState(state);
    if (!oauthData) {
      throw new Error('Invalid or expired OAuth state');
    }

    // Clean up OAuth state
    await redisService.deleteOAuthState(state);

    try {
      const tokenSet = await this.client.callback(
        this.redirectUri,
        { code, state },
        { code_verifier: oauthData.codeVerifier, nonce: oauthData.nonce }
      );

      return {
        access_token: tokenSet.access_token!,
        refresh_token: tokenSet.refresh_token!,
        id_token: tokenSet.id_token!,
        token_type: tokenSet.token_type!,
        expires_in: tokenSet.expires_in!,
        scope: tokenSet.scope!,
      };
    } catch (error) {
      console.error('Token exchange failed:', error);
      throw new Error('Failed to exchange authorization code for tokens');
    }
  }

  async getUserInfo(accessToken: string): Promise<KeycloakUserInfo> {
    if (!this.client) {
      throw new Error('Keycloak client not initialized');
    }

    try {
      const userInfo = await this.client.userinfo(accessToken);
      return userInfo as KeycloakUserInfo;
    } catch (error) {
      console.error('Failed to get user info:', error);
      throw new Error('Failed to retrieve user information');
    }
  }

  async refreshToken(refreshToken: string): Promise<KeycloakTokenResponse> {
    if (!this.client) {
      throw new Error('Keycloak client not initialized');
    }

    try {
      const tokenSet = await this.client.refresh(refreshToken);
      
      return {
        access_token: tokenSet.access_token!,
        refresh_token: tokenSet.refresh_token!,
        id_token: tokenSet.id_token!,
        token_type: tokenSet.token_type!,
        expires_in: tokenSet.expires_in!,
        scope: tokenSet.scope!,
      };
    } catch (error) {
      console.error('Token refresh failed:', error);
      throw new Error('Failed to refresh access token');
    }
  }

  async logout(refreshToken: string): Promise<void> {
    if (!this.client) {
      throw new Error('Keycloak client not initialized');
    }

    try {
      await this.client.revoke(refreshToken, 'refresh_token');
    } catch (error) {
      console.error('Logout failed:', error);
      // Don't throw error as we want to continue with local session cleanup
    }
  }

  generateLogoutUrl(idToken?: string): string {
    if (!this.client) {
      throw new Error('Keycloak client not initialized');
    }

    const params = new URLSearchParams({
      post_logout_redirect_uri: this.logoutRedirectUri,
    });

    if (idToken) {
      params.append('id_token_hint', idToken);
    }

    return `${this.client.issuer.metadata.end_session_endpoint}?${params.toString()}`;
  }

  // Helper method to create user session from tokens
  async createUserSession(
    accessToken: string,
    refreshToken: string,
    idToken: string
  ): Promise<UserSession> {
    const userInfo = await this.getUserInfo(accessToken);
    
    // Extract roles from token claims (you may need to adjust based on your Keycloak setup)
    const tokenClaims = this.parseJwt(accessToken);
    const roles = [
      ...(tokenClaims.realm_access?.roles || []),
      ...(tokenClaims.resource_access?.[this.clientId]?.roles || []),
    ];

    const session: UserSession = {
      id: uuidv4(),
      sub: userInfo.sub,
      tenantId: userInfo.tenantId || 'default',
      email: userInfo.email,
      name: userInfo.name,
      roles,
      permissions: [], // Will be populated based on roles
      accessTokenRef: accessToken,
      refreshTokenRef: refreshToken,
      expiresAt: Date.now() + (tokenClaims.exp - tokenClaims.iat) * 1000,
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };

    return session;
  }

  // Parse JWT token without verification (for extracting claims)
  private parseJwt(token: string): any {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
      );
      return JSON.parse(jsonPayload);
    } catch (error) {
      console.error('Failed to parse JWT token:', error);
      return {};
    }
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      if (!this.issuer) return false;
      
      const response = await fetch(`${this.issuer.metadata.issuer}/.well-known/openid_configuration`);
      return response.ok;
    } catch (error) {
      console.error('Keycloak health check failed:', error);
      return false;
    }
  }
}

// Singleton instance
export const keycloakService = new KeycloakService();
