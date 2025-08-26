import { NextRequest, NextResponse } from 'next/server';
import { withSession, requireRole, AuthenticatedRequest } from '@/middleware/session';
import { redisService } from '@/services/redis';
import { generateTraceId } from '@/lib/tracing';
import { z } from 'zod';

const StatsQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  tenantId: z.string().optional(),
  groupBy: z.enum(['day', 'hour', 'action', 'user', 'result']).default('day'),
});

/**
 * Get audit log statistics
 * GET /api/audit/stats
 */
async function handler(request: AuthenticatedRequest) {
  const traceId = generateTraceId();

  try {
    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const query = StatsQuerySchema.parse(searchParams);

    const stats = await getAuditStats(query, request.user!.tenantId);
    
    return NextResponse.json({
      success: true,
      data: stats,
      traceId,
    });
  } catch (error) {
    console.error('Audit stats API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'AUDIT_STATS_ERROR',
          message: 'Failed to get audit statistics',
          traceId,
        },
      },
      { status: 500 }
    );
  }
}

async function getAuditStats(
  query: z.infer<typeof StatsQuerySchema>,
  currentUserTenant: string
) {
  try {
    // Get all audit log keys from Redis
    const auditKeys = await redisService.getKeysByPattern('audit:*');
    const allLogs: any[] = [];

    // Fetch all logs
    for (const key of auditKeys) {
      try {
        const logData = await redisService.get(key);
        if (logData) {
          const log = JSON.parse(logData);
          allLogs.push(log);
        }
      } catch (error) {
        console.error(`Failed to parse audit log ${key}:`, error);
      }
    }

    // Filter logs based on query parameters
    let filteredLogs = allLogs.filter(log => {
      // Tenant isolation
      if (query.tenantId) {
        if (log.tenantId !== query.tenantId) return false;
      } else {
        if (log.tenantId !== currentUserTenant) return false;
      }

      // Date range filter
      if (query.startDate) {
        const logDate = new Date(log.timestamp);
        const startDate = new Date(query.startDate);
        if (logDate < startDate) return false;
      }

      if (query.endDate) {
        const logDate = new Date(log.timestamp);
        const endDate = new Date(query.endDate);
        if (logDate > endDate) return false;
      }

      return true;
    });

    const totalEvents = filteredLogs.length;
    
    // Calculate statistics
    const actionCounts: Record<string, number> = {};
    const resultCounts: Record<string, number> = {};
    const userCounts: Record<string, number> = {};
    const resourceTypeCounts: Record<string, number> = {};
    const tenantCounts: Record<string, number> = {};
    const hourlyStats: Record<string, number> = {};
    const dailyStats: Record<string, number> = {};

    filteredLogs.forEach(log => {
      // Action counts
      actionCounts[log.action] = (actionCounts[log.action] || 0) + 1;

      // Result counts
      resultCounts[log.result] = (resultCounts[log.result] || 0) + 1;

      // User counts
      userCounts[log.userId] = (userCounts[log.userId] || 0) + 1;

      // Resource type counts
      resourceTypeCounts[log.resourceType] = (resourceTypeCounts[log.resourceType] || 0) + 1;

      // Tenant counts
      tenantCounts[log.tenantId] = (tenantCounts[log.tenantId] || 0) + 1;

      // Time-based stats
      const logDate = new Date(log.timestamp);
      const hourKey = logDate.toISOString().substring(0, 13); // YYYY-MM-DDTHH
      const dayKey = logDate.toISOString().substring(0, 10); // YYYY-MM-DD

      hourlyStats[hourKey] = (hourlyStats[hourKey] || 0) + 1;
      dailyStats[dayKey] = (dailyStats[dayKey] || 0) + 1;
    });

    // Sort and limit top entries
    const topActions = Object.entries(actionCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10);

    const topUsers = Object.entries(userCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10);

    const topResourceTypes = Object.entries(resourceTypeCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10);

    // Security stats
    const securityEvents = filteredLogs.filter(log => 
      log.action.includes('security') || 
      log.resourceType === 'security' ||
      log.result === 'deny'
    );

    const threatsByType: Record<string, number> = {};
    const threatsBySeverity: Record<string, number> = {};

    securityEvents.forEach(log => {
      if (log.metadata?.threatType) {
        threatsByType[log.metadata.threatType] = (threatsByType[log.metadata.threatType] || 0) + 1;
      }
      if (log.metadata?.severity) {
        threatsBySeverity[log.metadata.severity] = (threatsBySeverity[log.metadata.severity] || 0) + 1;
      }
    });

    // Time series data based on groupBy
    let timeSeriesData: Array<{ time: string; count: number }> = [];
    
    if (query.groupBy === 'day') {
      timeSeriesData = Object.entries(dailyStats)
        .map(([date, count]) => ({ time: date, count }))
        .sort((a, b) => a.time.localeCompare(b.time));
    } else if (query.groupBy === 'hour') {
      timeSeriesData = Object.entries(hourlyStats)
        .map(([hour, count]) => ({ time: hour, count }))
        .sort((a, b) => a.time.localeCompare(b.time));
    }

    return {
      summary: {
        totalEvents,
        securityEvents: securityEvents.length,
        allowedEvents: filteredLogs.filter(log => log.result === 'allow').length,
        deniedEvents: filteredLogs.filter(log => log.result === 'deny').length,
        errorEvents: filteredLogs.filter(log => log.result === 'error').length,
        uniqueUsers: Object.keys(userCounts).length,
        uniqueTenants: Object.keys(tenantCounts).length,
      },
      timeSeries: timeSeriesData,
      topActions: topActions.map(([action, count]) => ({ action, count })),
      topUsers: topUsers.map(([userId, count]) => ({ userId, count })),
      topResourceTypes: topResourceTypes.map(([resourceType, count]) => ({ resourceType, count })),
      resultDistribution: Object.entries(resultCounts).map(([result, count]) => ({ result, count })),
      securityStats: {
        totalThreats: securityEvents.length,
        threatsByType: Object.entries(threatsByType).map(([type, count]) => ({ type, count })),
        threatsBySeverity: Object.entries(threatsBySeverity).map(([severity, count]) => ({ severity, count })),
      },
      query: {
        ...query,
        generatedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    console.error('Failed to get audit stats:', error);
    return {
      summary: {
        totalEvents: 0,
        securityEvents: 0,
        allowedEvents: 0,
        deniedEvents: 0,
        errorEvents: 0,
        uniqueUsers: 0,
        uniqueTenants: 0,
      },
      timeSeries: [],
      topActions: [],
      topUsers: [],
      topResourceTypes: [],
      resultDistribution: [],
      securityStats: {
        totalThreats: 0,
        threatsByType: [],
        threatsBySeverity: [],
      },
      query: {
        ...query,
        generatedAt: new Date().toISOString(),
      },
    };
  }
}

export const GET = withSession(requireRole(['admin', 'auditor'])(handler));