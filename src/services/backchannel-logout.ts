import {
  BackchannelLogoutToken,
  LogoutSession,
  ClientRegistration,
  LogoutEvent,
  LogoutNotificationResult,
  LogoutPolicy,
  LogoutAudit,
  BackchannelLogoutStats
} from '@/types/backchannel-logout';
import { redisService } from './redis';
import { generateTraceId } from '@/lib/tracing';
import { metricsCollector } from '@/lib/metrics';
import { errorTracker } from './error-tracking';
import * as jwt from 'jsonwebtoken';

export class BackchannelLogoutService {
  private readonly sessionKeyPrefix = 'logout:session:';
  private readonly clientKeyPrefix = 'logout:client:';
  private readonly eventKeyPrefix = 'logout:event:';
  private readonly policyKeyPrefix = 'logout:policy:';
  private readonly auditKeyPrefix = 'logout:audit:';
  
  private readonly jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
  private readonly issuer = process.env.TOKEN_ISSUER || 'keyfront-bff';
  private readonly defaultLogoutTimeout = 30000; // 30 seconds
  
  async initiateLogout(
    sessionId: string,
    userId: string,
    tenantId: string,
    options: {
      trigger: 'user_action' | 'admin_action' | 'system_timeout' | 'security_policy' | 'external_request';
      initiator?: { user_id?: string; client_id?: string; ip_address?: string; user_agent?: string };
      reason?: string;
      traceId?: string;
    }
  ): Promise<LogoutEvent> {
    const traceId = options.traceId || generateTraceId();
    const startTime = Date.now();
    
    try {
      // Get the primary session
      const session = await this.getLogoutSession(sessionId);
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      
      // Get applicable logout policy
      const policy = await this.getApplicableLogoutPolicy(tenantId, userId, session.clientId);
      
      // Create logout event
      const logoutEvent: LogoutEvent = {
        id: generateTraceId(),
        timestamp: new Date().toISOString(),
        traceId,
        tenantId,
        event_type: this.determineEventType(options.trigger),
        trigger: options.trigger,
        session_id: sessionId,
        user_id: userId,
        client_id: session.clientId,
        affected_sessions: [],
        notification_results: [],
        status: 'initiated',
        initiator: options.initiator,
      };
      
      // Find all sessions to terminate
      const sessionsToTerminate = await this.findSessionsToTerminate(
        sessionId, 
        userId, 
        tenantId, 
        policy
      );
      
      logoutEvent.affected_sessions = sessionsToTerminate.map(s => s.sessionId);
      
      // Store the logout event
      await this.storeLogoutEvent(logoutEvent);
      
      // Update status
      logoutEvent.status = 'in_progress';
      await this.updateLogoutEvent(logoutEvent);
      
      // Terminate sessions
      await this.terminateSessions(sessionsToTerminate, logoutEvent.id);
      
      // Get clients to notify
      const clientsToNotify = await this.getClientsToNotify(sessionsToTerminate, policy);
      
      // Send back-channel logout notifications
      const notificationResults = await this.sendLogoutNotifications(
        logoutEvent,
        clientsToNotify,
        sessionsToTerminate
      );
      
      logoutEvent.notification_results = notificationResults;
      
      // Check if logout is complete
      const isComplete = await this.checkLogoutCompletion(logoutEvent, policy);
      logoutEvent.status = isComplete ? 'completed' : 'partial';
      logoutEvent.completion_time = new Date().toISOString();
      
      // Update final event
      await this.updateLogoutEvent(logoutEvent);
      
      // Record metrics
      await metricsCollector.incrementCounter(
        'backchannel_logouts_total',
        {
          tenant_id: tenantId,
          trigger: options.trigger,
          status: logoutEvent.status,
          sessions_count: logoutEvent.affected_sessions.length.toString(),
        },
        1,
        'Total back-channel logout events'
      );
      
      await metricsCollector.observeHistogram(
        'backchannel_logout_duration_seconds',
        (Date.now() - startTime) / 1000,
        {
          tenant_id: tenantId,
          notifications_sent: notificationResults.length.toString(),
        },
        'Back-channel logout duration'
      );
      
      // Audit the logout
      await this.auditLogout(logoutEvent, Date.now() - startTime);
      
      return logoutEvent;
      
    } catch (error) {
      console.error('Back-channel logout error:', error);
      
      // Record error metrics
      await metricsCollector.incrementCounter(
        'backchannel_logouts_total',
        {
          tenant_id: tenantId,
          trigger: options.trigger,
          status: 'failed',
        },
        1,
        'Total back-channel logout events'
      );
      
      // Track error
      await errorTracker.recordError({
        message: error instanceof Error ? error.message : 'Unknown back-channel logout error',
        type: 'BackchannelLogoutError',
        severity: 'high',
        traceId,
        tenantId,
        context: {
          sessionId,
          userId,
          trigger: options.trigger,
        },
        tags: ['backchannel-logout', 'session-management', 'security'],
      });
      
      throw error;
    }
  }
  
  private determineEventType(trigger: string): LogoutEvent['event_type'] {
    switch (trigger) {
      case 'user_action':
        return 'user_logout';
      case 'admin_action':
        return 'admin_logout';
      case 'system_timeout':
        return 'timeout_logout';
      case 'security_policy':
      case 'external_request':
        return 'session_terminated';
      default:
        return 'session_terminated';
    }
  }
  
  private async getLogoutSession(sessionId: string): Promise<LogoutSession | null> {
    try {
      const sessionData = await redisService.get(`${this.sessionKeyPrefix}${sessionId}`);
      return sessionData ? JSON.parse(sessionData) : null;
    } catch (error) {
      console.error('Failed to get logout session:', error);
      return null;
    }
  }
  
  private async storeLogoutSession(session: LogoutSession): Promise<void> {
    try {
      await redisService.set(
        `${this.sessionKeyPrefix}${session.sessionId}`,
        JSON.stringify(session),
        Math.floor((session.expiresAt - Date.now()) / 1000)
      );
    } catch (error) {
      console.error('Failed to store logout session:', error);
    }
  }
  
  private async findSessionsToTerminate(
    primarySessionId: string,
    userId: string,
    tenantId: string,
    policy?: LogoutPolicy
  ): Promise<LogoutSession[]> {
    try {
      const sessionKeys = await redisService.getKeysByPattern(`${this.sessionKeyPrefix}*`);
      const sessions: LogoutSession[] = [];
      
      for (const key of sessionKeys) {
        const sessionData = await redisService.get(key);
        if (!sessionData) continue;
        
        const session: LogoutSession = JSON.parse(sessionData);
        
        // Include primary session
        if (session.sessionId === primarySessionId) {
          sessions.push(session);
          continue;
        }
        
        // Check if session should be terminated based on policy
        if (policy?.logout_behavior.terminate_all_sessions && 
            session.userId === userId && 
            session.tenantId === tenantId) {
          sessions.push(session);
          continue;
        }
        
        // Check related sessions
        if (policy?.logout_behavior.terminate_related_sessions &&
            session.relatedSessions?.includes(primarySessionId)) {
          sessions.push(session);
          continue;
        }
      }
      
      return sessions;
    } catch (error) {
      console.error('Failed to find sessions to terminate:', error);
      return [];
    }
  }
  
  private async terminateSessions(sessions: LogoutSession[], logoutEventId: string): Promise<void> {
    for (const session of sessions) {
      try {
        // Mark session as logged out
        session.logoutInitiated = true;
        session.logoutRequestedAt = new Date().toISOString();
        
        await this.storeLogoutSession(session);
        
        // Remove from Redis session store (actual session termination)
        await redisService.delete(`session:${session.sessionId}`);
        
        console.log(`Terminated session: ${session.sessionId} for user: ${session.userId}`);
      } catch (error) {
        console.error(`Failed to terminate session ${session.sessionId}:`, error);
      }
    }
  }
  
  private async getClientsToNotify(
    sessions: LogoutSession[],
    policy?: LogoutPolicy
  ): Promise<ClientRegistration[]> {
    try {
      const uniqueClientIds = [...new Set(sessions.map(s => s.clientId).filter(Boolean))] as string[];
      const clients: ClientRegistration[] = [];
      
      for (const clientId of uniqueClientIds) {
        const clientData = await redisService.get(`${this.clientKeyPrefix}${clientId}`);
        if (clientData) {
          const client: ClientRegistration = JSON.parse(clientData);
          
          // Only notify clients with back-channel logout configured
          if (client.backchannel_logout_uri && client.logout_notification_enabled) {
            clients.push(client);
          }
        }
      }
      
      return clients;
    } catch (error) {
      console.error('Failed to get clients to notify:', error);
      return [];
    }
  }
  
  private async sendLogoutNotifications(
    logoutEvent: LogoutEvent,
    clients: ClientRegistration[],
    sessions: LogoutSession[]
  ): Promise<LogoutNotificationResult[]> {
    const results: LogoutNotificationResult[] = [];
    
    for (const client of clients) {
      const result: LogoutNotificationResult = {
        client_id: client.client_id,
        client_name: client.client_name,
        backchannel_logout_uri: client.backchannel_logout_uri,
        status: 'pending',
        retry_count: 0,
        max_retries: 3,
      };
      
      try {
        // Find sessions for this client
        const clientSessions = sessions.filter(s => s.clientId === client.client_id);
        
        if (clientSessions.length === 0) {
          result.status = 'acknowledged';
          results.push(result);
          continue;
        }
        
        // Create logout token
        const logoutToken = await this.createLogoutToken(
          logoutEvent,
          client,
          clientSessions
        );
        
        // Send notification
        await this.sendLogoutNotification(client, logoutToken, result);
        
      } catch (error) {
        console.error(`Failed to send logout notification to ${client.client_id}:`, error);
        result.status = 'failed';
        result.error_description = error instanceof Error ? error.message : 'Unknown error';
      }
      
      results.push(result);
    }
    
    return results;
  }
  
  private async createLogoutToken(
    logoutEvent: LogoutEvent,
    client: ClientRegistration,
    sessions: LogoutSession[]
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    
    // Determine which sessions/subs to include
    const sub = sessions[0]?.userId;
    const sid = client.backchannel_logout_session_required ? sessions[0]?.sessionId : undefined;
    
    const logoutTokenPayload: BackchannelLogoutToken = {
      iss: this.issuer,
      aud: client.client_id,
      iat: now,
      jti: generateTraceId(),
      events: {
        'http://schemas.openid.net/secevent/risc/event-type/sessions-revoked': {},
      },
      exp: now + 300, // 5 minutes
    };
    
    // Add sub or sid (at least one required)
    if (sub) logoutTokenPayload.sub = sub;
    if (sid) logoutTokenPayload.sid = sid;
    
    return jwt.sign(logoutTokenPayload, this.jwtSecret, {
      algorithm: 'HS256',
      keyid: 'keyfront-backchannel-logout',
    });
  }
  
  private async sendLogoutNotification(
    client: ClientRegistration,
    logoutToken: string,
    result: LogoutNotificationResult
  ): Promise<void> {
    if (!client.backchannel_logout_uri) {
      throw new Error('No back-channel logout URI configured');
    }
    
    result.sent_at = new Date().toISOString();
    result.timeout_at = new Date(Date.now() + client.logout_timeout_seconds * 1000).toISOString();
    
    const body = new URLSearchParams();
    body.append('logout_token', logoutToken);
    
    try {
      const response = await fetch(client.backchannel_logout_uri, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Keyfront-BFF/1.0',
        },
        body: body.toString(),
      });
      
      result.http_status = response.status;
      result.status = response.ok ? 'acknowledged' : 'failed';
      result.acknowledged_at = response.ok ? new Date().toISOString() : undefined;
      
      if (!response.ok) {
        result.error_description = await response.text();
      }
      
    } catch (error) {
      result.status = 'failed';
      result.error_description = error instanceof Error ? error.message : 'Network error';
    }
  }
  
  private async checkLogoutCompletion(
    logoutEvent: LogoutEvent,
    policy?: LogoutPolicy
  ): Promise<boolean> {
    // Check if all required notifications were successful
    const requiredNotifications = logoutEvent.notification_results.filter(r => 
      r.status === 'pending' || r.status === 'sent'
    );
    
    if (requiredNotifications.length > 0) {
      // Wait for acknowledgments or timeout
      return false;
    }
    
    // Check for failures
    const failures = logoutEvent.notification_results.filter(r => r.status === 'failed');
    
    // Complete if no failures or failures are acceptable
    return failures.length === 0 || !policy?.logout_behavior.require_client_acknowledgment;
  }
  
  private async getApplicableLogoutPolicy(
    tenantId: string,
    userId: string,
    clientId?: string
  ): Promise<LogoutPolicy | undefined> {
    try {
      const policyKeys = await redisService.getKeysByPattern(`${this.policyKeyPrefix}${tenantId}:*`);
      const policies: LogoutPolicy[] = [];
      
      for (const key of policyKeys) {
        const policyData = await redisService.get(key);
        if (policyData) {
          const policy: LogoutPolicy = JSON.parse(policyData);
          if (policy.enabled && this.policyApplies(policy, userId, clientId)) {
            policies.push(policy);
          }
        }
      }
      
      // Return highest priority policy
      return policies.sort((a, b) => b.priority - a.priority)[0];
    } catch (error) {
      console.error('Failed to get applicable logout policy:', error);
      return undefined;
    }
  }
  
  private policyApplies(policy: LogoutPolicy, userId: string, clientId?: string): boolean {
    const appliesTo = policy.applies_to;
    
    if (appliesTo.all_users) return true;
    if (appliesTo.specific_users?.includes(userId)) return true;
    if (clientId && appliesTo.specific_clients?.includes(clientId)) return true;
    
    // Additional checks for user roles and client types would go here
    
    return false;
  }
  
  private async storeLogoutEvent(event: LogoutEvent): Promise<void> {
    try {
      await redisService.set(
        `${this.eventKeyPrefix}${event.id}`,
        JSON.stringify(event),
        30 * 24 * 60 * 60 // 30 days
      );
    } catch (error) {
      console.error('Failed to store logout event:', error);
    }
  }
  
  private async updateLogoutEvent(event: LogoutEvent): Promise<void> {
    await this.storeLogoutEvent(event);
  }
  
  private async auditLogout(event: LogoutEvent, durationMs: number): Promise<void> {
    try {
      const audit: LogoutAudit = {
        id: generateTraceId(),
        timestamp: new Date().toISOString(),
        traceId: event.traceId,
        tenantId: event.tenantId,
        logout_event_id: event.id,
        session_id: event.session_id,
        user_id: event.user_id,
        logout_type: this.mapTriggerToType(event.trigger),
        logout_initiator: event.initiator?.user_id || event.initiator?.client_id,
        sessions_terminated: event.affected_sessions.length,
        tokens_revoked: event.affected_sessions.length, // Assuming 1:1 ratio
        clients_notified: event.notification_results.length,
        notification_failures: event.notification_results.filter(r => r.status === 'failed').length,
        total_duration_ms: durationMs,
        ip_address: event.initiator?.ip_address,
        user_agent: event.initiator?.user_agent,
      };
      
      await redisService.set(
        `${this.auditKeyPrefix}${audit.id}`,
        JSON.stringify(audit),
        90 * 24 * 60 * 60 // 90 days for audit retention
      );
    } catch (error) {
      console.error('Failed to audit logout:', error);
    }
  }
  
  private mapTriggerToType(trigger: LogoutEvent['trigger']): LogoutAudit['logout_type'] {
    switch (trigger) {
      case 'user_action': return 'voluntary';
      case 'admin_action': return 'administrative';
      case 'system_timeout': return 'timeout';
      case 'security_policy': return 'security';
      case 'external_request': return 'forced';
      default: return 'forced';
    }
  }
  
  // Client registration management
  async registerClient(client: Omit<ClientRegistration, 'metadata'>): Promise<ClientRegistration> {
    const newClient: ClientRegistration = {
      ...client,
      metadata: {
        createdBy: 'system', // Should be passed from request context
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };
    
    await redisService.set(
      `${this.clientKeyPrefix}${client.client_id}`,
      JSON.stringify(newClient),
      365 * 24 * 60 * 60 // 1 year
    );
    
    return newClient;
  }
  
  async getBackchannelLogoutStats(tenantId: string, days: number = 30): Promise<BackchannelLogoutStats> {
    // Implementation would aggregate data from audit logs and events
    // This is a simplified version
    return {
      total_logout_events: 0,
      successful_logouts: 0,
      failed_logouts: 0,
      average_logout_duration_ms: 0,
      average_notification_time_ms: 0,
      clients_with_backchannel: 0,
      notification_success_rate: 0,
      logout_events_by_type: {},
      logout_events_by_trigger: {},
      daily_logout_counts: [],
      top_failure_reasons: [],
    };
  }
}

export const backchannelLogoutService = new BackchannelLogoutService();