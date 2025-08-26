import { NextRequest, NextResponse } from 'next/server';
import { withSession, requireRole, AuthenticatedRequest } from '@/middleware/session';
import { redisService } from '@/services/redis';
import { LogoutEvent } from '@/types/backchannel-logout';
import { generateTraceId } from '@/lib/tracing';
import { z } from 'zod';

const EventQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  status: z.enum(['initiated', 'in_progress', 'completed', 'failed', 'partial']).optional(),
  trigger: z.enum(['user_action', 'admin_action', 'system_timeout', 'security_policy', 'external_request']).optional(),
  user_id: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
});

/**
 * Get back-channel logout events
 * GET /api/logout/backchannel/events
 */
async function getHandler(request: AuthenticatedRequest) {
  const traceId = generateTraceId();

  try {
    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const query = EventQuerySchema.parse(searchParams);
    
    const tenantId = request.user!.tenantId;
    const isAdmin = request.user!.roles.includes('admin');
    
    // Get all logout event keys for the tenant
    const eventKeys = await redisService.getKeysByPattern(`logout:event:*`);
    const events: LogoutEvent[] = [];
    
    for (const key of eventKeys) {
      try {
        const eventData = await redisService.get(key);
        if (!eventData) continue;
        
        const event: LogoutEvent = JSON.parse(eventData);
        
        // Filter by tenant
        if (event.tenantId !== tenantId) continue;
        
        // Non-admins can only see their own events
        if (!isAdmin && event.user_id !== request.user!.sub) continue;
        
        // Apply filters
        if (query.status && event.status !== query.status) continue;
        if (query.trigger && event.trigger !== query.trigger) continue;
        if (query.user_id && event.user_id !== query.user_id) continue;
        
        // Date filters
        if (query.start_date) {
          const eventDate = new Date(event.timestamp);
          const startDate = new Date(query.start_date);
          if (eventDate < startDate) continue;
        }
        
        if (query.end_date) {
          const eventDate = new Date(event.timestamp);
          const endDate = new Date(query.end_date);
          if (eventDate > endDate) continue;
        }
        
        events.push(event);
      } catch (error) {
        console.error(`Failed to parse logout event from key ${key}:`, error);
      }
    }
    
    // Sort by timestamp (newest first)
    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    // Apply pagination
    const total = events.length;
    const startIndex = (query.page - 1) * query.limit;
    const paginatedEvents = events.slice(startIndex, startIndex + query.limit);
    
    // Transform events to remove sensitive data for non-admins
    const transformedEvents = paginatedEvents.map(event => {
      const transformed = { ...event };
      
      if (!isAdmin) {
        // Remove sensitive initiator information
        if (transformed.initiator) {
          transformed.initiator = {
            user_id: transformed.initiator.user_id,
          };
        }
      }
      
      return transformed;
    });

    return NextResponse.json({
      success: true,
      data: {
        events: transformedEvents,
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.ceil(total / query.limit),
        },
        filters: {
          status: query.status,
          trigger: query.trigger,
          user_id: query.user_id,
          start_date: query.start_date,
          end_date: query.end_date,
        },
      },
      traceId,
    });
  } catch (error) {
    console.error('Logout events API error:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
            details: error.errors,
            traceId,
          },
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'EVENTS_LIST_ERROR',
          message: 'Failed to retrieve logout events',
          traceId,
        },
      },
      { status: 500 }
    );
  }
}

export const GET = withSession(requireRole(['admin', 'user'])(getHandler));