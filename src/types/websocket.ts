import { UserSession } from './auth';

export interface WebSocketMessage {
  id: string;
  type: 'message' | 'ping' | 'pong' | 'error' | 'close';
  payload?: any;
  timestamp: number;
  traceId?: string;
}

export interface WebSocketConnection {
  id: string;
  userId: string;
  tenantId: string;
  roles: string[];
  connectedAt: number;
  lastActivity: number;
  subscriptions: string[];
}

export interface WebSocketProxyOptions {
  targetUrl: string;
  headers?: Record<string, string>;
  timeout?: number;
  retryCount?: number;
  retryDelay?: number;
}

export interface WebSocketRateLimitInfo {
  connectionsPerUser: number;
  messagesPerMinute: number;
  maxConnections: number;
  currentConnections: number;
}

export interface WebSocketEventData {
  connectionId: string;
  event: 'connect' | 'disconnect' | 'message' | 'error';
  user: UserSession;
  data?: any;
  error?: string;
  timestamp: number;
  traceId: string;
}

export interface WebSocketHealthCheck {
  totalConnections: number;
  activeConnections: number;
  connectionsByTenant: Record<string, number>;
  messageRate: number;
  lastCheck: number;
}