import { LogoutPolicy } from '@/types/backchannel-logout';
import { generateTraceId } from '@/lib/tracing';
import { redisService } from './redis';

export class BackchannelLogoutPolicyTemplates {
  
  static createDefaultLogoutPolicy(tenantId: string, createdBy: string): LogoutPolicy {
    return {
      id: generateTraceId(),
      name: 'Default Logout Policy',
      tenantId,
      
      applies_to: {
        all_users: true,
      },
      
      logout_behavior: {
        terminate_all_sessions: true,
        terminate_related_sessions: true,
        preserve_refresh_tokens: false,
        notify_all_clients: true,
        require_client_acknowledgment: false,
        notification_timeout_seconds: 30,
        max_notification_retries: 3,
        cascade_to_related_accounts: false,
        cascade_depth_limit: 1,
      },
      
      auto_logout_conditions: {
        idle_timeout_minutes: 60,
        absolute_timeout_minutes: 480, // 8 hours
        concurrent_session_limit: 5,
      },
      
      security_policies: {
        require_re_authentication_after: 28800, // 8 hours
        log_security_events: true,
        notify_security_team: false,
        quarantine_suspicious_sessions: true,
      },
      
      priority: 100,
      enabled: true,
      
      metadata: {
        createdBy,
        createdAt: new Date().toISOString(),
        updatedBy: createdBy,
        updatedAt: new Date().toISOString(),
        description: 'Default logout policy for all users with basic security settings',
      },
    };
  }
  
  static createAdminLogoutPolicy(tenantId: string, createdBy: string): LogoutPolicy {
    return {
      id: generateTraceId(),
      name: 'Administrator Logout Policy',
      tenantId,
      
      applies_to: {
        user_roles: ['admin', 'super_admin'],
      },
      
      logout_behavior: {
        terminate_all_sessions: true,
        terminate_related_sessions: true,
        preserve_refresh_tokens: false,
        notify_all_clients: true,
        require_client_acknowledgment: true, // Require confirmation for admin logouts
        notification_timeout_seconds: 60,
        max_notification_retries: 5,
        grace_period_seconds: 10, // Allow cancellation
        cascade_to_related_accounts: true,
        cascade_depth_limit: 2,
      },
      
      auto_logout_conditions: {
        idle_timeout_minutes: 30, // Shorter timeout for admins
        absolute_timeout_minutes: 240, // 4 hours max
        suspicious_activity_score: 70,
        concurrent_session_limit: 3,
        location_change_logout: true,
      },
      
      security_policies: {
        require_re_authentication_after: 14400, // 4 hours
        log_security_events: true,
        notify_security_team: true,
        quarantine_suspicious_sessions: true,
      },
      
      priority: 200, // Higher priority than default
      enabled: true,
      
      metadata: {
        createdBy,
        createdAt: new Date().toISOString(),
        updatedBy: createdBy,
        updatedAt: new Date().toISOString(),
        description: 'Enhanced security logout policy for administrators',
      },
    };
  }
  
  static createServiceAccountPolicy(tenantId: string, createdBy: string): LogoutPolicy {
    return {
      id: generateTraceId(),
      name: 'Service Account Logout Policy',
      tenantId,
      
      applies_to: {
        user_roles: ['service_account'],
        client_types: ['service', 'machine_to_machine'],
      },
      
      logout_behavior: {
        terminate_all_sessions: false, // Service accounts may have long-running sessions
        terminate_related_sessions: false,
        preserve_refresh_tokens: true,
        notify_all_clients: true,
        require_client_acknowledgment: true,
        notification_timeout_seconds: 120, // Longer timeout for services
        max_notification_retries: 5,
        cascade_to_related_accounts: false,
        cascade_depth_limit: 0,
      },
      
      auto_logout_conditions: {
        idle_timeout_minutes: 720, // 12 hours for service accounts
        absolute_timeout_minutes: 10080, // 7 days
        concurrent_session_limit: 10,
      },
      
      security_policies: {
        require_re_authentication_after: 86400, // 24 hours
        log_security_events: true,
        notify_security_team: true,
        quarantine_suspicious_sessions: true,
      },
      
      priority: 150,
      enabled: true,
      
      metadata: {
        createdBy,
        createdAt: new Date().toISOString(),
        updatedBy: createdBy,
        updatedAt: new Date().toISOString(),
        description: 'Specialized logout policy for service accounts and machine-to-machine clients',
      },
    };
  }
  
  static createHighSecurityPolicy(tenantId: string, createdBy: string): LogoutPolicy {
    return {
      id: generateTraceId(),
      name: 'High Security Logout Policy',
      tenantId,
      
      applies_to: {
        user_roles: ['security_officer', 'compliance_officer'],
        specific_users: [], // Can be populated with specific high-value accounts
      },
      
      logout_behavior: {
        terminate_all_sessions: true,
        terminate_related_sessions: true,
        preserve_refresh_tokens: false,
        notify_all_clients: true,
        require_client_acknowledgment: true,
        notification_timeout_seconds: 45,
        max_notification_retries: 7,
        grace_period_seconds: 5,
        cascade_to_related_accounts: true,
        cascade_depth_limit: 3,
      },
      
      auto_logout_conditions: {
        idle_timeout_minutes: 15, // Very short timeout
        absolute_timeout_minutes: 120, // 2 hours max
        suspicious_activity_score: 50,
        concurrent_session_limit: 2,
        location_change_logout: true,
      },
      
      security_policies: {
        require_re_authentication_after: 7200, // 2 hours
        log_security_events: true,
        notify_security_team: true,
        quarantine_suspicious_sessions: true,
      },
      
      priority: 300, // Highest priority
      enabled: true,
      
      metadata: {
        createdBy,
        createdAt: new Date().toISOString(),
        updatedBy: createdBy,
        updatedAt: new Date().toISOString(),
        description: 'Maximum security logout policy for high-value accounts',
      },
    };
  }
  
  static createGuestUserPolicy(tenantId: string, createdBy: string): LogoutPolicy {
    return {
      id: generateTraceId(),
      name: 'Guest User Logout Policy',
      tenantId,
      
      applies_to: {
        user_roles: ['guest', 'visitor', 'trial_user'],
      },
      
      logout_behavior: {
        terminate_all_sessions: true,
        terminate_related_sessions: false,
        preserve_refresh_tokens: false,
        notify_all_clients: false, // Minimal notifications for guests
        require_client_acknowledgment: false,
        notification_timeout_seconds: 15,
        max_notification_retries: 1,
        cascade_to_related_accounts: false,
        cascade_depth_limit: 0,
      },
      
      auto_logout_conditions: {
        idle_timeout_minutes: 30,
        absolute_timeout_minutes: 120, // 2 hours max for guests
        concurrent_session_limit: 2,
      },
      
      security_policies: {
        require_re_authentication_after: 3600, // 1 hour
        log_security_events: true,
        notify_security_team: false,
        quarantine_suspicious_sessions: false,
      },
      
      priority: 50, // Lower priority
      enabled: true,
      
      metadata: {
        createdBy,
        createdAt: new Date().toISOString(),
        updatedBy: createdBy,
        updatedAt: new Date().toISOString(),
        description: 'Streamlined logout policy for guest and trial users',
      },
    };
  }
  
  static async initializeDefaultPolicies(tenantId: string, createdBy: string): Promise<LogoutPolicy[]> {
    const policies = [
      this.createDefaultLogoutPolicy(tenantId, createdBy),
      this.createAdminLogoutPolicy(tenantId, createdBy),
      this.createServiceAccountPolicy(tenantId, createdBy),
      this.createHighSecurityPolicy(tenantId, createdBy),
      this.createGuestUserPolicy(tenantId, createdBy),
    ];
    
    const createdPolicies: LogoutPolicy[] = [];
    
    for (const policy of policies) {
      try {
        const policyKey = `logout:policy:${tenantId}:${policy.id}`;
        await redisService.set(policyKey, JSON.stringify(policy), 365 * 24 * 60 * 60); // 1 year
        createdPolicies.push(policy);
        console.log(`Created logout policy: ${policy.name}`);
      } catch (error) {
        console.error(`Failed to create logout policy ${policy.name}:`, error);
      }
    }
    
    return createdPolicies;
  }
  
  static async createEmergencyLogoutPolicy(tenantId: string, createdBy: string): Promise<LogoutPolicy> {
    const emergencyPolicy: LogoutPolicy = {
      id: generateTraceId(),
      name: 'Emergency Security Logout Policy',
      tenantId,
      
      applies_to: {
        all_users: true, // Applies to everyone during emergency
      },
      
      logout_behavior: {
        terminate_all_sessions: true,
        terminate_related_sessions: true,
        preserve_refresh_tokens: false,
        notify_all_clients: true,
        require_client_acknowledgment: false, // No time to wait during emergency
        notification_timeout_seconds: 10,
        max_notification_retries: 1,
        cascade_to_related_accounts: true,
        cascade_depth_limit: 5, // Maximum cascading during emergency
      },
      
      auto_logout_conditions: {
        idle_timeout_minutes: 1, // Immediate logout
        absolute_timeout_minutes: 5, // Very short sessions during emergency
        suspicious_activity_score: 20, // Very low threshold
        concurrent_session_limit: 1,
        location_change_logout: true,
      },
      
      security_policies: {
        require_re_authentication_after: 300, // 5 minutes
        log_security_events: true,
        notify_security_team: true,
        quarantine_suspicious_sessions: true,
      },
      
      priority: 1000, // Maximum priority
      enabled: false, // Disabled by default, activated during emergencies
      
      metadata: {
        createdBy,
        createdAt: new Date().toISOString(),
        updatedBy: createdBy,
        updatedAt: new Date().toISOString(),
        description: 'Emergency logout policy for security incidents (DISABLED BY DEFAULT)',
      },
    };
    
    // Store the policy
    const policyKey = `logout:policy:${tenantId}:${emergencyPolicy.id}`;
    await redisService.set(policyKey, JSON.stringify(emergencyPolicy), 365 * 24 * 60 * 60);
    
    return emergencyPolicy;
  }
}

export const backchannelLogoutPolicyTemplates = new BackchannelLogoutPolicyTemplates();