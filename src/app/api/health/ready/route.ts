import { NextRequest, NextResponse } from 'next/server';
import { healthChecker } from '@/lib/health-check';

/**
 * Kubernetes readiness probe
 * GET /api/health/ready
 */
export async function GET(request: NextRequest) {
  try {
    const isReady = await healthChecker.isReady();
    
    if (isReady) {
      const health = await healthChecker.getBasicHealth();
      return NextResponse.json({
        status: 'ready',
        service_status: health.status,
        timestamp: new Date().toISOString(),
        uptime: health.uptime,
        version: health.version,
      });
    } else {
      return NextResponse.json({
        status: 'not_ready',
        timestamp: new Date().toISOString(),
        reason: 'Service dependencies unavailable',
      }, { status: 503 });
    }
  } catch (error) {
    console.error('Readiness check error:', error);
    return NextResponse.json({
      status: 'not_ready',
      timestamp: new Date().toISOString(),
      error: 'Readiness check failed',
    }, { status: 503 });
  }
}