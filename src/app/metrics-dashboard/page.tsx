'use client';

import { useState, useEffect } from 'react';

interface MetricsSummary {
  totalMetrics: number;
  metricsByType: Record<string, number>;
  lastUpdated: string;
  topMetrics: Array<{ name: string; value: number; type: string }>;
}

export default function MetricsDashboard() {
  const [summary, setSummary] = useState<MetricsSummary | null>(null);
  const [prometheusMetrics, setPrometheusMetrics] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showRawMetrics, setShowRawMetrics] = useState(false);

  useEffect(() => {
    loadMetricsSummary();
    if (showRawMetrics) {
      loadPrometheusMetrics();
    }
  }, [showRawMetrics]);

  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      loadMetricsSummary();
      if (showRawMetrics) {
        loadPrometheusMetrics();
      }
    }, 15000); // 15 seconds

    return () => clearInterval(interval);
  }, [autoRefresh, showRawMetrics]);

  const loadMetricsSummary = async () => {
    try {
      const response = await fetch('/api/metrics/summary', {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        setSummary(data.data);
      }
    } catch (error) {
      console.error('Failed to load metrics summary:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadPrometheusMetrics = async () => {
    try {
      const response = await fetch('/api/metrics?format=prometheus', {
        credentials: 'include'
      });
      
      if (response.ok) {
        const metrics = await response.text();
        setPrometheusMetrics(metrics);
      }
    } catch (error) {
      console.error('Failed to load Prometheus metrics:', error);
    }
  };

  const getMetricTypeColor = (type: string) => {
    switch (type) {
      case 'counter': return 'bg-blue-100 text-blue-800';
      case 'gauge': return 'bg-green-100 text-green-800';
      case 'histogram': return 'bg-purple-100 text-purple-800';
      case 'summary': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const formatValue = (value: number) => {
    if (value >= 1000000) {
      return `${(value / 1000000).toFixed(1)}M`;
    } else if (value >= 1000) {
      return `${(value / 1000).toFixed(1)}K`;
    }
    return value.toFixed(0);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">메트릭 로드 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            📊 Prometheus 메트릭 대시보드
          </h1>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded"
              />
              <label className="text-sm text-gray-600">자동 새로고침</label>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={showRawMetrics}
                onChange={(e) => setShowRawMetrics(e.target.checked)}
                className="rounded"
              />
              <label className="text-sm text-gray-600">원시 메트릭 표시</label>
            </div>
            <button
              onClick={() => {
                loadMetricsSummary();
                if (showRawMetrics) loadPrometheusMetrics();
              }}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            >
              🔄 새로고침
            </button>
          </div>
        </div>

        {/* 메트릭 요약 */}
        {summary && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
              <div className="bg-white rounded-lg shadow p-6">
                <div className="text-2xl font-bold text-blue-600">
                  {summary.totalMetrics}
                </div>
                <div className="text-sm text-blue-700">총 메트릭</div>
              </div>

              {Object.entries(summary.metricsByType).map(([type, count]) => (
                <div key={type} className="bg-white rounded-lg shadow p-6">
                  <div className="text-2xl font-bold text-gray-900">
                    {count}
                  </div>
                  <div className={`text-sm px-2 py-1 rounded inline-block ${getMetricTypeColor(type)}`}>
                    {type}
                  </div>
                </div>
              ))}
            </div>

            {/* 상위 메트릭 */}
            <div className="bg-white rounded-lg shadow p-6 mb-6">
              <h3 className="text-lg font-semibold mb-4">🏆 상위 메트릭</h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2">메트릭 이름</th>
                      <th className="text-left py-2">타입</th>
                      <th className="text-right py-2">값</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.topMetrics.map((metric, index) => (
                      <tr key={index} className="border-b border-gray-100">
                        <td className="py-2 font-mono text-sm">{metric.name}</td>
                        <td className="py-2">
                          <span className={`px-2 py-1 rounded text-xs ${getMetricTypeColor(metric.type)}`}>
                            {metric.type}
                          </span>
                        </td>
                        <td className="py-2 text-right font-semibold">
                          {formatValue(metric.value)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 메트릭 통계 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold mb-4">📈 메트릭 타입별 분포</h3>
                <div className="space-y-3">
                  {Object.entries(summary.metricsByType).map(([type, count]) => {
                    const percentage = (count / summary.totalMetrics) * 100;
                    return (
                      <div key={type}>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-sm font-medium capitalize">{type}</span>
                          <span className="text-sm text-gray-600">{count} ({percentage.toFixed(1)}%)</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div 
                            className={`h-2 rounded-full ${
                              type === 'counter' ? 'bg-blue-500' :
                              type === 'gauge' ? 'bg-green-500' :
                              type === 'histogram' ? 'bg-purple-500' :
                              'bg-yellow-500'
                            }`}
                            style={{ width: `${percentage}%` }}
                          ></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold mb-4">ℹ️ 메트릭 정보</h3>
                <div className="space-y-3 text-sm">
                  <div>
                    <div className="font-medium text-gray-700">마지막 업데이트:</div>
                    <div className="text-gray-600">
                      {new Date(summary.lastUpdated).toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="font-medium text-gray-700">수집 간격:</div>
                    <div className="text-gray-600">15초 (자동)</div>
                  </div>
                  <div>
                    <div className="font-medium text-gray-700">Prometheus 엔드포인트:</div>
                    <div className="font-mono text-xs bg-gray-100 p-2 rounded">
                      GET /api/metrics
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* 원시 Prometheus 메트릭 */}
        {showRawMetrics && (
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">📜 Prometheus 포맷 메트릭</h3>
              <button
                onClick={() => navigator.clipboard.writeText(prometheusMetrics)}
                className="text-sm bg-gray-500 text-white px-3 py-1 rounded hover:bg-gray-600"
              >
                📋 복사
              </button>
            </div>
            <div className="bg-gray-900 text-green-400 p-4 rounded font-mono text-sm max-h-96 overflow-y-auto">
              <pre>{prometheusMetrics || '메트릭 로드 중...'}</pre>
            </div>
          </div>
        )}

        {/* Prometheus 설정 가이드 */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mt-6">
          <h3 className="text-lg font-semibold text-blue-800 mb-4">🔧 Prometheus 설정</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-blue-700">
            <div>
              <h4 className="font-semibold mb-2">Scrape 설정</h4>
              <div className="bg-blue-100 p-3 rounded font-mono text-xs">
                <div>- job_name: 'keyfront-bff'</div>
                <div>  static_configs:</div>
                <div>  - targets: ['localhost:3000']</div>
                <div>  metrics_path: '/api/metrics'</div>
                <div>  scrape_interval: 15s</div>
              </div>
            </div>
            <div>
              <h4 className="font-semibold mb-2">주요 메트릭</h4>
              <ul className="space-y-1 text-sm">
                <li>• http_requests_total - HTTP 요청 수</li>
                <li>• http_request_duration_seconds - 응답 시간</li>
                <li>• websocket_events_total - WebSocket 이벤트</li>
                <li>• auth_events_total - 인증 이벤트</li>
                <li>• security_threats_total - 보안 위협</li>
                <li>• nodejs_memory_usage_bytes - 메모리 사용량</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}