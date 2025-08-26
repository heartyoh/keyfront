'use client';

import { useState, useEffect } from 'react';

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  build?: string;
  commit?: string;
}

interface ServiceHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  responseTime: number;
  lastCheck: string;
  error?: string;
  details?: Record<string, any>;
}

interface DetailedHealthReport {
  overall: HealthStatus;
  services: ServiceHealth[];
  metrics: {
    totalRequests: number;
    errorRate: number;
    avgResponseTime: number;
    activeConnections: number;
    memoryUsage: {
      used: number;
      total: number;
      percentage: number;
    };
  };
  dependencies: {
    redis: ServiceHealth;
    keycloak: ServiceHealth;
  };
}

export default function HealthDashboard() {
  const [basicHealth, setBasicHealth] = useState<HealthStatus | null>(null);
  const [detailedHealth, setDetailedHealth] = useState<DetailedHealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(30); // seconds

  useEffect(() => {
    loadBasicHealth();
    loadDetailedHealth();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      loadBasicHealth();
      if (refreshInterval <= 60) { // Only auto-refresh detailed if interval is short
        loadDetailedHealth();
      }
    }, refreshInterval * 1000);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval]);

  const loadBasicHealth = async () => {
    try {
      const response = await fetch('/api/health', {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        setBasicHealth(data);
      }
    } catch (error) {
      console.error('Failed to load basic health:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadDetailedHealth = async () => {
    try {
      const response = await fetch('/api/health/detailed?refresh=true', {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        setDetailedHealth(data.data);
      }
    } catch (error) {
      console.error('Failed to load detailed health:', error);
    }
  };

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  };

  const formatBytes = (bytes: number) => {
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'text-green-600 bg-green-100';
      case 'degraded': return 'text-yellow-600 bg-yellow-100';
      case 'unhealthy': return 'text-red-600 bg-red-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy': return '✅';
      case 'degraded': return '⚠️';
      case 'unhealthy': return '❌';
      default: return '❓';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">헬스체크 로드 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            🏥 시스템 헬스 대시보드
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
            <select
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(Number(e.target.value))}
              disabled={!autoRefresh}
              className="border border-gray-300 rounded px-3 py-1 text-sm"
            >
              <option value={10}>10초</option>
              <option value={30}>30초</option>
              <option value={60}>1분</option>
              <option value={300}>5분</option>
            </select>
            <button
              onClick={() => {
                loadBasicHealth();
                loadDetailedHealth();
              }}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            >
              🔄 새로고침
            </button>
          </div>
        </div>

        {/* 전체 상태 */}
        {basicHealth && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold mb-2">전체 시스템 상태</h2>
                <div className="flex items-center space-x-4">
                  <div className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(basicHealth.status)}`}>
                    {getStatusIcon(basicHealth.status)} {basicHealth.status.toUpperCase()}
                  </div>
                  <div className="text-sm text-gray-600">
                    업타임: {formatUptime(basicHealth.uptime)}
                  </div>
                  <div className="text-sm text-gray-600">
                    버전: {basicHealth.version}
                    {basicHealth.commit && ` (${basicHealth.commit})`}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-gray-900">
                  {basicHealth.status === 'healthy' ? '🟢' : 
                   basicHealth.status === 'degraded' ? '🟡' : '🔴'}
                </div>
                <div className="text-xs text-gray-500">
                  {new Date(basicHealth.timestamp).toLocaleString()}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 상세 정보 */}
        {detailedHealth && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* 시스템 메트릭 */}
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold mb-4">📊 시스템 메트릭</h3>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-sm text-gray-600">메모리 사용률</span>
                    <span className="text-sm font-medium">{detailedHealth.metrics.memoryUsage.percentage}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className={`h-2 rounded-full ${
                        detailedHealth.metrics.memoryUsage.percentage > 90 ? 'bg-red-500' :
                        detailedHealth.metrics.memoryUsage.percentage > 70 ? 'bg-yellow-500' : 'bg-green-500'
                      }`}
                      style={{ width: `${detailedHealth.metrics.memoryUsage.percentage}%` }}
                    ></div>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {formatBytes(detailedHealth.metrics.memoryUsage.used)} / {formatBytes(detailedHealth.metrics.memoryUsage.total)}
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-blue-50 p-3 rounded">
                    <div className="text-2xl font-bold text-blue-600">
                      {detailedHealth.metrics.totalRequests.toLocaleString()}
                    </div>
                    <div className="text-sm text-blue-700">총 요청 수</div>
                  </div>
                  <div className="bg-green-50 p-3 rounded">
                    <div className="text-2xl font-bold text-green-600">
                      {detailedHealth.metrics.activeConnections}
                    </div>
                    <div className="text-sm text-green-700">활성 연결</div>
                  </div>
                  <div className="bg-purple-50 p-3 rounded">
                    <div className="text-2xl font-bold text-purple-600">
                      {Math.round(detailedHealth.metrics.avgResponseTime)}ms
                    </div>
                    <div className="text-sm text-purple-700">평균 응답시간</div>
                  </div>
                  <div className="bg-orange-50 p-3 rounded">
                    <div className="text-2xl font-bold text-orange-600">
                      {(detailedHealth.metrics.errorRate * 100).toFixed(2)}%
                    </div>
                    <div className="text-sm text-orange-700">에러율</div>
                  </div>
                </div>
              </div>
            </div>

            {/* 의존성 상태 */}
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold mb-4">🔗 의존성 상태</h3>
              <div className="space-y-4">
                {Object.entries(detailedHealth.dependencies).map(([name, service]) => (
                  <div key={name} className="border border-gray-200 rounded p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-2">
                        <span className="font-medium capitalize">{name}</span>
                        <div className={`px-2 py-1 rounded text-xs ${getStatusColor(service.status)}`}>
                          {getStatusIcon(service.status)} {service.status}
                        </div>
                      </div>
                      <div className="text-sm text-gray-600">
                        {service.responseTime >= 0 ? `${service.responseTime}ms` : 'N/A'}
                      </div>
                    </div>
                    
                    {service.error && (
                      <div className="text-sm text-red-600 bg-red-50 p-2 rounded">
                        {service.error}
                      </div>
                    )}
                    
                    {service.details && (
                      <div className="text-xs text-gray-500 mt-2">
                        {Object.entries(service.details).map(([key, value]) => (
                          <div key={key}>
                            <strong>{key}:</strong> {String(value)}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 헬스체크 엔드포인트 정보 */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">🔗 헬스체크 엔드포인트</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="border border-gray-200 rounded p-4">
              <div className="font-medium text-green-600">기본 헬스체크</div>
              <div className="text-sm text-gray-600 mt-1">
                <code>GET /api/health</code>
              </div>
              <div className="text-xs text-gray-500 mt-2">
                기본적인 서비스 상태 확인
              </div>
            </div>
            
            <div className="border border-gray-200 rounded p-4">
              <div className="font-medium text-blue-600">생존 확인 (Liveness)</div>
              <div className="text-sm text-gray-600 mt-1">
                <code>GET /api/health/live</code>
              </div>
              <div className="text-xs text-gray-500 mt-2">
                Kubernetes 생존 프로브
              </div>
            </div>
            
            <div className="border border-gray-200 rounded p-4">
              <div className="font-medium text-purple-600">준비 상태 (Readiness)</div>
              <div className="text-sm text-gray-600 mt-1">
                <code>GET /api/health/ready</code>
              </div>
              <div className="text-xs text-gray-500 mt-2">
                Kubernetes 준비 프로브
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}