import { NextRequest, NextResponse } from 'next/server';
import { metricsCollector } from '@/lib/metrics';

/**
 * Prometheus metrics endpoint
 * GET /api/metrics
 */
export async function GET(request: NextRequest) {
  try {
    // Check if request is from Prometheus (optional security)
    const userAgent = request.headers.get('user-agent');
    const acceptHeader = request.headers.get('accept');
    
    // Basic validation for Prometheus scraper
    const isPrometheusRequest = 
      userAgent?.includes('Prometheus') || 
      acceptHeader?.includes('text/plain') ||
      request.nextUrl.searchParams.get('format') === 'prometheus';

    if (!isPrometheusRequest && process.env.NODE_ENV === 'production') {
      // In production, only allow Prometheus scrapers
      // You might want to add IP whitelisting here
      const authHeader = request.headers.get('authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        );
      }
      
      // Validate bearer token (implement your logic)
      const token = authHeader.substring(7);
      if (token !== process.env.METRICS_TOKEN) {
        return NextResponse.json(
          { error: 'Invalid token' },
          { status: 403 }
        );
      }
    }

    const prometheusMetrics = metricsCollector.getPrometheusMetrics();
    
    return new NextResponse(prometheusMetrics, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    console.error('Metrics endpoint error:', error);
    return NextResponse.json(
      { error: 'Failed to generate metrics' },
      { status: 500 }
    );
  }
}