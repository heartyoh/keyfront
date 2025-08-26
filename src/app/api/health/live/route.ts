import { NextRequest, NextResponse } from 'next/server';
import { healthChecker } from '@/lib/health-check';

/**
 * Kubernetes liveness probe
 * GET /api/health/live
 */
export async function GET(request: NextRequest) {
  try {
    const isAlive = await healthChecker.isAlive();
    
    if (isAlive) {
      return NextResponse.json({
        status: 'alive',
        timestamp: new Date().toISOString(),
      });
    } else {
      return NextResponse.json({
        status: 'not_alive',
        timestamp: new Date().toISOString(),
      }, { status: 503 });
    }
  } catch (error) {
    console.error('Liveness check error:', error);
    return NextResponse.json({
      status: 'not_alive',
      timestamp: new Date().toISOString(),
      error: 'Liveness check failed',
    }, { status: 503 });
  }
}