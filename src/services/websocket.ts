import { WebSocket, WebSocketServer, RawData } from 'ws';
import { IncomingMessage } from 'http';
import { NextRequest } from 'next/server';
import { UserSession } from '@/types/auth';
import { redisService } from '@/services/redis';
import { auditEvents } from '@/lib/audit';
import { generateTraceId, startSpan, finishSpan } from '@/lib/tracing';
import { rateLimiters } from '@/lib/rate-limit';

export interface WebSocketConnection {
  id: string;
  websocket: WebSocket;
  session: UserSession;
  traceId: string;
  connectedAt: number;
  lastActivity: number;
  channels: Set<string>;
}

export interface WebSocketMessage {
  type: string;
  channel?: string;
  data?: any;
  traceId?: string;
}

export interface DownstreamWebSocketConfig {
  url: string;
  protocols?: string[];
  headers?: Record<string, string>;
  reconnect?: boolean;
  maxReconnectAttempts?: number;
  reconnectDelay?: number;
}

export class WebSocketService {
  private connections: Map<string, WebSocketConnection> = new Map();
  private channelSubscriptions: Map<string, Set<string>> = new Map(); // channel -> connection IDs
  private downstreamConnections: Map<string, WebSocket> = new Map(); // connection ID -> downstream WS
  private wss: WebSocketServer | null = null;

  constructor() {
    // Clean up inactive connections periodically
    setInterval(() => {
      this.cleanupInactiveConnections();
    }, 60000); // Every minute
  }

  // Check connection rate limits
  async checkConnectionLimit(session: UserSession, traceId: string) {
    // Check per-user WebSocket connection limit
    const userConnections = Array.from(this.connections.values())
      .filter(conn => conn.session.sub === session.sub).length;

    const maxUserConnections = parseInt(process.env.WS_MAX_USER_CONNECTIONS || '5');
    
    if (userConnections >= maxUserConnections) {
      return {
        allowed: false,
        limit: maxUserConnections,
        current: userConnections,
      };
    }

    // Check tenant-level limits
    const tenantConnections = Array.from(this.connections.values())
      .filter(conn => conn.session.tenantId === session.tenantId).length;

    const maxTenantConnections = parseInt(process.env.WS_MAX_TENANT_CONNECTIONS || '100');

    if (tenantConnections >= maxTenantConnections) {
      return {
        allowed: false,
        limit: maxTenantConnections,
        current: tenantConnections,
      };
    }

    return {
      allowed: true,
      limit: maxUserConnections,
      current: userConnections,
    };
  }

  // Upgrade HTTP request to WebSocket
  upgrade(request: NextRequest): { response: Response; websocket: WebSocket | null } {
    try {
      // For Next.js, we need to handle WebSocket upgrade differently
      // This is a simplified version - in production, you might need a custom server
      
      // Create WebSocket response headers
      const key = request.headers.get('sec-websocket-key');
      if (!key) {
        return {
          response: new Response('Missing WebSocket key', { status: 400 }),
          websocket: null,
        };
      }

      // Generate WebSocket accept key
      const acceptKey = this.generateAcceptKey(key);

      const response = new Response(null, {
        status: 101,
        statusText: 'Switching Protocols',
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade',
          'Sec-WebSocket-Accept': acceptKey,
        },
      });

      // Note: In a real implementation, you'd need to handle the actual WebSocket upgrade
      // This might require a custom Node.js server or using Next.js with a custom server
      console.log('WebSocket upgrade requested - would normally return WebSocket instance');

      return {
        response,
        websocket: null, // Placeholder - actual WebSocket would be created here
      };

    } catch (error) {
      console.error('WebSocket upgrade failed:', error);
      return {
        response: new Response('WebSocket upgrade failed', { status: 500 }),
        websocket: null,
      };
    }
  }

  // Handle new WebSocket connection
  async handleConnection(websocket: WebSocket, session: UserSession, traceId: string) {
    const connectionId = this.generateConnectionId();
    const connection: WebSocketConnection = {
      id: connectionId,
      websocket,
      session,
      traceId,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      channels: new Set(),
    };

    // Store connection
    this.connections.set(connectionId, connection);

    console.log(`🔌 WebSocket connected: ${connectionId} (user: ${session.sub}, tenant: ${session.tenantId})`);

    // Set up event handlers
    websocket.on('message', (data: RawData) => {
      this.handleMessage(connectionId, data);
    });

    websocket.on('close', (code: number, reason: Buffer) => {
      this.handleDisconnection(connectionId, code, reason);
    });

    websocket.on('error', (error: Error) => {
      console.error(`WebSocket error for ${connectionId}:`, error);
      this.handleDisconnection(connectionId, 1006, Buffer.from('Error occurred'));
    });

    websocket.on('pong', () => {
      // Update last activity on pong response
      const conn = this.connections.get(connectionId);
      if (conn) {
        conn.lastActivity = Date.now();
      }
    });

    // Send welcome message
    this.sendMessage(connectionId, {
      type: 'welcome',
      data: {
        connectionId,
        serverTime: Date.now(),
        user: {
          sub: session.sub,
          tenantId: session.tenantId,
          roles: session.roles,
        },
      },
    });

    // Log connection
    await auditEvents.login(traceId, session.tenantId, session.sub, 'allow', 'WebSocket connection established');

    // Start periodic ping
    this.startPingTimer(connectionId);
  }

  // Handle incoming WebSocket message
  private async handleMessage(connectionId: string, rawData: RawData) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    const span = startSpan(connection.traceId, 'ws_message_handling');

    try {
      connection.lastActivity = Date.now();

      let message: WebSocketMessage;
      try {
        message = JSON.parse(rawData.toString());
      } catch (error) {
        this.sendError(connectionId, 'INVALID_JSON', 'Invalid JSON message format');
        return;
      }

      // Validate message structure
      if (!message.type) {
        this.sendError(connectionId, 'MISSING_TYPE', 'Message type is required');
        return;
      }

      console.log(`📨 WebSocket message from ${connectionId}:`, message.type);

      // Handle different message types
      switch (message.type) {
        case 'subscribe':
          await this.handleSubscribe(connectionId, message);
          break;

        case 'unsubscribe':
          await this.handleUnsubscribe(connectionId, message);
          break;

        case 'proxy':
          await this.handleProxyMessage(connectionId, message);
          break;

        case 'ping':
          this.sendMessage(connectionId, { type: 'pong', traceId: message.traceId });
          break;

        default:
          this.sendError(connectionId, 'UNKNOWN_TYPE', `Unknown message type: ${message.type}`);
      }

      finishSpan(connection.traceId, span.spanId, { messageType: message.type });

    } catch (error) {
      console.error(`Error handling WebSocket message for ${connectionId}:`, error);
      this.sendError(connectionId, 'PROCESSING_ERROR', 'Failed to process message');
      finishSpan(connection.traceId, span.spanId, { error: true });
    }
  }

  // Handle channel subscription
  private async handleSubscribe(connectionId: string, message: WebSocketMessage) {
    const connection = this.connections.get(connectionId);
    if (!connection || !message.channel) return;

    // Check if user has permission to subscribe to this channel
    const hasPermission = await this.checkChannelPermission(
      connection.session,
      message.channel,
      'subscribe'
    );

    if (!hasPermission) {
      this.sendError(connectionId, 'FORBIDDEN', `No permission to subscribe to ${message.channel}`);
      return;
    }

    // Add to channel subscriptions
    connection.channels.add(message.channel);
    
    if (!this.channelSubscriptions.has(message.channel)) {
      this.channelSubscriptions.set(message.channel, new Set());
    }
    this.channelSubscriptions.get(message.channel)!.add(connectionId);

    this.sendMessage(connectionId, {
      type: 'subscribed',
      channel: message.channel,
      traceId: message.traceId,
    });

    console.log(`🔔 ${connectionId} subscribed to ${message.channel}`);
  }

  // Handle channel unsubscription
  private async handleUnsubscribe(connectionId: string, message: WebSocketMessage) {
    const connection = this.connections.get(connectionId);
    if (!connection || !message.channel) return;

    // Remove from channel subscriptions
    connection.channels.delete(message.channel);
    
    const channelSubs = this.channelSubscriptions.get(message.channel);
    if (channelSubs) {
      channelSubs.delete(connectionId);
      if (channelSubs.size === 0) {
        this.channelSubscriptions.delete(message.channel);
      }
    }

    this.sendMessage(connectionId, {
      type: 'unsubscribed',
      channel: message.channel,
      traceId: message.traceId,
    });

    console.log(`🔕 ${connectionId} unsubscribed from ${message.channel}`);
  }

  // Handle proxy message to downstream WebSocket
  private async handleProxyMessage(connectionId: string, message: WebSocketMessage) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    // Check rate limits for proxy messages
    const rateLimitResult = await rateLimiters.api.check(
      { headers: new Headers(), ip: 'websocket' } as any,
      connection.session,
      connection.traceId
    );

    if (!rateLimitResult.allowed) {
      this.sendError(connectionId, 'RATE_LIMITED', 'Too many proxy messages');
      return;
    }

    // Get or create downstream WebSocket connection
    const downstreamWs = await this.getOrCreateDownstreamConnection(connectionId, connection);
    if (!downstreamWs) {
      this.sendError(connectionId, 'DOWNSTREAM_UNAVAILABLE', 'Cannot connect to downstream service');
      return;
    }

    // Forward message to downstream
    try {
      downstreamWs.send(JSON.stringify({
        ...message.data,
        userContext: {
          sub: connection.session.sub,
          tenantId: connection.session.tenantId,
          roles: connection.session.roles,
        },
        traceId: message.traceId || generateTraceId(),
      }));
    } catch (error) {
      console.error('Failed to send to downstream WebSocket:', error);
      this.sendError(connectionId, 'PROXY_ERROR', 'Failed to proxy message');
    }
  }

  // Get or create downstream WebSocket connection
  private async getOrCreateDownstreamConnection(
    connectionId: string,
    connection: WebSocketConnection
  ): Promise<WebSocket | null> {
    let downstreamWs = this.downstreamConnections.get(connectionId);

    if (downstreamWs && downstreamWs.readyState === WebSocket.OPEN) {
      return downstreamWs;
    }

    // Create new downstream connection
    try {
      const downstreamUrl = process.env.DOWNSTREAM_WS_URL || 'ws://localhost:4000/ws';
      downstreamWs = new WebSocket(downstreamUrl, {
        headers: {
          'Authorization': `Bearer ${connection.session.accessTokenRef}`,
          'X-Tenant-ID': connection.session.tenantId,
          'X-User-ID': connection.session.sub,
          'X-Trace-ID': connection.traceId,
        },
      });

      // Handle downstream messages
      downstreamWs.on('message', (data: RawData) => {
        try {
          const message = JSON.parse(data.toString());
          this.sendMessage(connectionId, {
            type: 'downstream',
            data: message,
          });
        } catch (error) {
          console.error('Failed to parse downstream message:', error);
        }
      });

      downstreamWs.on('close', () => {
        this.downstreamConnections.delete(connectionId);
      });

      downstreamWs.on('error', (error: Error) => {
        console.error('Downstream WebSocket error:', error);
        this.downstreamConnections.delete(connectionId);
      });

      this.downstreamConnections.set(connectionId, downstreamWs);
      return downstreamWs;

    } catch (error) {
      console.error('Failed to create downstream WebSocket:', error);
      return null;
    }
  }

  // Send message to specific connection
  private sendMessage(connectionId: string, message: WebSocketMessage) {
    const connection = this.connections.get(connectionId);
    if (!connection || connection.websocket.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      connection.websocket.send(JSON.stringify(message));
    } catch (error) {
      console.error(`Failed to send message to ${connectionId}:`, error);
    }
  }

  // Send error message
  private sendError(connectionId: string, code: string, message: string) {
    this.sendMessage(connectionId, {
      type: 'error',
      data: {
        code,
        message,
        timestamp: Date.now(),
      },
    });
  }

  // Broadcast message to channel subscribers
  broadcastToChannel(channel: string, message: WebSocketMessage) {
    const subscribers = this.channelSubscriptions.get(channel);
    if (!subscribers) return;

    subscribers.forEach(connectionId => {
      this.sendMessage(connectionId, {
        ...message,
        channel,
      });
    });
  }

  // Handle disconnection
  private async handleDisconnection(connectionId: string, code: number, reason: Buffer) {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    console.log(`🔌 WebSocket disconnected: ${connectionId} (code: ${code}, reason: ${reason.toString()})`);

    // Clean up subscriptions
    connection.channels.forEach(channel => {
      const channelSubs = this.channelSubscriptions.get(channel);
      if (channelSubs) {
        channelSubs.delete(connectionId);
        if (channelSubs.size === 0) {
          this.channelSubscriptions.delete(channel);
        }
      }
    });

    // Close downstream connection
    const downstreamWs = this.downstreamConnections.get(connectionId);
    if (downstreamWs) {
      downstreamWs.close();
      this.downstreamConnections.delete(connectionId);
    }

    // Remove connection
    this.connections.delete(connectionId);

    // Log disconnection
    await auditEvents.logout(connection.traceId, connection.session.tenantId, connection.session.sub, {
      connectionId,
      duration: Date.now() - connection.connectedAt,
      closeCode: code,
      closeReason: reason.toString(),
    });
  }

  // Check channel permission
  private async checkChannelPermission(
    session: UserSession,
    channel: string,
    action: 'subscribe' | 'publish'
  ): Promise<boolean> {
    // Basic tenant isolation
    if (channel.startsWith(`tenant:${session.tenantId}:`)) {
      return true;
    }

    // User-specific channels
    if (channel === `user:${session.sub}`) {
      return true;
    }

    // Role-based channels
    if (channel.startsWith('admin:') && session.roles.includes('ADMIN')) {
      return true;
    }

    // Public channels
    if (channel.startsWith('public:')) {
      return true;
    }

    return false;
  }

  // Start ping timer for connection
  private startPingTimer(connectionId: string) {
    const pingInterval = setInterval(() => {
      const connection = this.connections.get(connectionId);
      if (!connection || connection.websocket.readyState !== WebSocket.OPEN) {
        clearInterval(pingInterval);
        return;
      }

      connection.websocket.ping();
    }, 30000); // Ping every 30 seconds
  }

  // Clean up inactive connections
  private cleanupInactiveConnections() {
    const now = Date.now();
    const maxInactiveTime = 5 * 60 * 1000; // 5 minutes

    for (const [connectionId, connection] of this.connections.entries()) {
      if (now - connection.lastActivity > maxInactiveTime) {
        console.log(`🧹 Cleaning up inactive WebSocket connection: ${connectionId}`);
        connection.websocket.close(1001, 'Connection timeout');
        this.handleDisconnection(connectionId, 1001, Buffer.from('Timeout'));
      }
    }
  }

  // Get connection statistics
  async getConnectionStats() {
    const totalConnections = this.connections.size;
    const connectionsByTenant = new Map<string, number>();
    const connectionsByChannel = new Map<string, number>();

    for (const connection of this.connections.values()) {
      // Count by tenant
      const tenantCount = connectionsByTenant.get(connection.session.tenantId) || 0;
      connectionsByTenant.set(connection.session.tenantId, tenantCount + 1);

      // Count by channel
      connection.channels.forEach(channel => {
        const channelCount = connectionsByChannel.get(channel) || 0;
        connectionsByChannel.set(channel, channelCount + 1);
      });
    }

    return {
      totalConnections,
      totalChannels: this.channelSubscriptions.size,
      connectionsByTenant: Object.fromEntries(connectionsByTenant),
      connectionsByChannel: Object.fromEntries(connectionsByChannel),
      uptime: process.uptime(),
    };
  }

  // Utility functions
  private generateConnectionId(): string {
    return `ws_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  private generateAcceptKey(key: string): string {
    const crypto = require('crypto');
    const magicString = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
    return crypto
      .createHash('sha1')
      .update(key + magicString)
      .digest('base64');
  }

  /**
   * Get current connection count for health checks
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Get connection statistics
   */
  getConnectionStats(): {
    total: number;
    byTenant: Record<string, number>;
    byUser: Record<string, number>;
  } {
    const stats = {
      total: this.connections.size,
      byTenant: {} as Record<string, number>,
      byUser: {} as Record<string, number>,
    };

    this.connections.forEach(conn => {
      // Count by tenant
      const tenant = conn.session.tenantId;
      stats.byTenant[tenant] = (stats.byTenant[tenant] || 0) + 1;

      // Count by user
      const user = conn.session.sub;
      stats.byUser[user] = (stats.byUser[user] || 0) + 1;
    });

    return stats;
  }
}

// Singleton instance
export const websocketService = new WebSocketService();