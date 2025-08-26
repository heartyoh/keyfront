import { NextRequest, NextResponse } from 'next/server';
import { healthChecker } from '@/lib/health-check';

/**
 * Basic health check endpoint
 * GET /api/health
 */
export async function GET(request: NextRequest) {
  try {
    const health = await healthChecker.getBasicHealth();
    
    const statusCode = health.status === 'unhealthy' ? 503 : 
                      health.status === 'degraded' ? 200 : 200;

    return NextResponse.json(health, { status: statusCode });
  } catch (error) {
    console.error('Health check error:', error);
    return NextResponse.json(
      {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        uptime: 0,
        version: '0.1.0',
        error: 'Health check failed',
      },
      { status: 503 }
    );
  }
}