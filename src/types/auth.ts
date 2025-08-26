export interface UserSession {
  id: string;
  sub: string;
  tenantId: string;
  email?: string;
  name?: string;
  roles: string[];
  permissions: string[];
  accessTokenRef: string;
  refreshTokenRef: string;
  expiresAt: number;
  createdAt: number;
  lastActivity: number;
}

export interface KeycloakTokenResponse {
  access_token: string;
  refresh_token: string;
  id_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

export interface KeycloakUserInfo {
  sub: string;
  email_verified: boolean;
  name: string;
  preferred_username: string;
  given_name: string;
  family_name: string;
  email: string;
  tenantId?: string;
  orgPath?: string;
}

export interface AuthContext {
  user: UserSession | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

export interface LoginRequest {
  redirectUri?: string;
  state?: string;
  nonce?: string;
}

export interface AuthCallback {
  code: string;
  state?: string;
  session_state?: string;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface LogoutRequest {
  redirectUri?: string;
  idTokenHint?: string;
}
