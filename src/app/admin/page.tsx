'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface DashboardStats {
  system: {
    uptime: string;
    version: string;
    environment: string;
    lastRestart: string;
  };
  sessions: {
    active: number;
    total: number;
    peak24h: number;
    averageDuration: string;
  };
  security: {
    abacPolicies: number;
    tokenExchanges24h: number;
    backchannelLogouts24h: number;
    securityAlerts: number;
  };
  tenants: {
    total: number;
    active: number;
    configurations: number;
  };
  performance: {
    avgResponseTime: number;
    requestsPerSecond: number;
    errorRate: number;
    memoryUsage: number;
  };
}

interface QuickAction {
  id: string;
  title: string;
  description: string;
  icon: string;
  href: string;
  color: string;
  urgent?: boolean;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    loadDashboardStats();
    const interval = setInterval(() => {
      setCurrentTime(new Date());
      loadDashboardStats();
    }, 30000); // Update every 30 seconds

    return () => clearInterval(interval);
  }, []);

  const loadDashboardStats = async () => {
    try {
      // Load stats from multiple endpoints
      const [healthResponse, sessionsResponse, securityResponse] = await Promise.allSettled([
        fetch('/api/health/detailed', { credentials: 'include' }),
        fetch('/api/admin/stats/sessions', { credentials: 'include' }),
        fetch('/api/admin/stats/security', { credentials: 'include' }),
      ]);

      // Mock stats for demo - in production, combine real API responses
      const mockStats: DashboardStats = {
        system: {
          uptime: '2d 14h 32m',
          version: '1.0.0',
          environment: 'production',
          lastRestart: '2024-01-20T10:30:00Z',
        },
        sessions: {
          active: 145,
          total: 2847,
          peak24h: 289,
          averageDuration: '2h 15m',
        },
        security: {
          abacPolicies: 12,
          tokenExchanges24h: 47,
          backchannelLogouts24h: 8,
          securityAlerts: 2,
        },
        tenants: {
          total: 8,
          active: 7,
          configurations: 24,
        },
        performance: {
          avgResponseTime: 145,
          requestsPerSecond: 23.4,
          errorRate: 0.02,
          memoryUsage: 68.5,
        },
      };

      setStats(mockStats);
    } catch (error) {
      console.error('Failed to load dashboard stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const quickActions: QuickAction[] = [
    {
      id: 'health',
      title: '시스템 상태',
      description: '헬스체크 및 모니터링',
      icon: '🏥',
      href: '/health-dashboard',
      color: 'bg-green-100 text-green-800 border-green-200',
    },
    {
      id: 'metrics',
      title: 'Prometheus 메트릭',
      description: '성능 및 사용량 모니터링',
      icon: '📊',
      href: '/metrics-dashboard',
      color: 'bg-blue-100 text-blue-800 border-blue-200',
    },
    {
      id: 'audit',
      title: '감사 로그',
      description: '보안 이벤트 및 접근 기록',
      icon: '🔍',
      href: '/audit-dashboard',
      color: 'bg-purple-100 text-purple-800 border-purple-200',
    },
    {
      id: 'tenants',
      title: '테넌트 관리',
      description: '멀티테넌트 설정 및 정책',
      icon: '🏢',
      href: '/tenant-dashboard',
      color: 'bg-orange-100 text-orange-800 border-orange-200',
    },
    {
      id: 'errors',
      title: '에러 모니터링',
      description: '오류 추적 및 알림',
      icon: '🚨',
      href: '/error-dashboard',
      color: 'bg-red-100 text-red-800 border-red-200',
      urgent: stats?.performance.errorRate && stats.performance.errorRate > 0.01,
    },
    {
      id: 'abac',
      title: 'ABAC 정책',
      description: '속성 기반 접근 제어',
      icon: '🛡️',
      href: '/admin/abac',
      color: 'bg-indigo-100 text-indigo-800 border-indigo-200',
    },
    {
      id: 'token-exchange',
      title: '토큰 교환',
      description: 'OAuth 토큰 교환 관리',
      icon: '🔄',
      href: '/admin/token-exchange',
      color: 'bg-cyan-100 text-cyan-800 border-cyan-200',
    },
    {
      id: 'logout',
      title: 'Back-channel 로그아웃',
      description: '중앙 집중식 세션 관리',
      icon: '🚪',
      href: '/admin/logout',
      color: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    },
    {
      id: 'users',
      title: '사용자 관리',
      description: '사용자 계정 및 권한',
      icon: '👥',
      href: '/admin/users',
      color: 'bg-gray-100 text-gray-800 border-gray-200',
    },
    {
      id: 'settings',
      title: '시스템 설정',
      description: '전역 설정 및 구성',
      icon: '⚙️',
      href: '/admin/settings',
      color: 'bg-slate-100 text-slate-800 border-slate-200',
    },
  ];

  const getStatusColor = (value: number, thresholds: { good: number; warning: number }) => {
    if (value <= thresholds.good) return 'text-green-600';
    if (value <= thresholds.warning) return 'text-yellow-600';
    return 'text-red-600';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">관리 대시보드 로드 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                🔐 Keyfront BFF 관리 센터
              </h1>
              <p className="text-sm text-gray-600">
                엔터프라이즈급 Backend-for-Frontend 게이트웨이 관리
              </p>
            </div>
            <div className="text-right">
              <div className="text-sm text-gray-600">
                현재 시간: {currentTime.toLocaleString()}
              </div>
              <div className="text-xs text-gray-500">
                시스템 가동 시간: {stats?.system.uptime}
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* System Status Overview */}
        {stats && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">📈 시스템 현황</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white rounded-lg shadow p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">활성 세션</p>
                    <p className="text-2xl font-bold text-blue-600">{stats.sessions.active}</p>
                  </div>
                  <div className="text-blue-500">👤</div>
                </div>
                <p className="text-xs text-gray-500 mt-1">24시간 최대: {stats.sessions.peak24h}</p>
              </div>

              <div className="bg-white rounded-lg shadow p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">보안 알림</p>
                    <p className={`text-2xl font-bold ${stats.security.securityAlerts > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {stats.security.securityAlerts}
                    </p>
                  </div>
                  <div className={stats.security.securityAlerts > 0 ? 'text-red-500' : 'text-green-500'}>🛡️</div>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {stats.security.securityAlerts > 0 ? '즉시 확인 필요' : '모두 정상'}
                </p>
              </div>

              <div className="bg-white rounded-lg shadow p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">평균 응답시간</p>
                    <p className={`text-2xl font-bold ${getStatusColor(stats.performance.avgResponseTime, { good: 100, warning: 200 })}`}>
                      {stats.performance.avgResponseTime}ms
                    </p>
                  </div>
                  <div className="text-green-500">⚡</div>
                </div>
                <p className="text-xs text-gray-500 mt-1">RPS: {stats.performance.requestsPerSecond}</p>
              </div>

              <div className="bg-white rounded-lg shadow p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">오류율</p>
                    <p className={`text-2xl font-bold ${getStatusColor(stats.performance.errorRate * 100, { good: 1, warning: 5 })}`}>
                      {(stats.performance.errorRate * 100).toFixed(2)}%
                    </p>
                  </div>
                  <div className={stats.performance.errorRate > 0.01 ? 'text-red-500' : 'text-green-500'}>📊</div>
                </div>
                <p className="text-xs text-gray-500 mt-1">메모리: {stats.performance.memoryUsage}%</p>
              </div>
            </div>
          </div>
        )}

        {/* Quick Actions Grid */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">🚀 빠른 작업</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {quickActions.map((action) => (
              <Link
                key={action.id}
                href={action.href}
                className={`block p-4 rounded-lg border-2 transition-all hover:shadow-md hover:scale-[1.02] ${action.color} ${
                  action.urgent ? 'ring-2 ring-red-400 animate-pulse' : ''
                }`}
              >
                <div className="flex items-center space-x-3">
                  <div className="text-2xl">{action.icon}</div>
                  <div>
                    <h3 className="font-semibold text-sm">{action.title}</h3>
                    <p className="text-xs opacity-75">{action.description}</p>
                    {action.urgent && (
                      <span className="inline-block mt-1 px-2 py-1 text-xs bg-red-200 text-red-800 rounded">
                        주의 필요
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Recent Activity & Alerts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg shadow">
            <div className="p-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">🕐 최근 활동</h3>
            </div>
            <div className="p-4">
              <div className="space-y-3">
                <div className="flex items-center space-x-3 text-sm">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="text-gray-600">5분 전</span>
                  <span>새로운 ABAC 정책이 적용되었습니다</span>
                </div>
                <div className="flex items-center space-x-3 text-sm">
                  <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                  <span className="text-gray-600">12분 전</span>
                  <span>토큰 교환이 성공적으로 완료되었습니다</span>
                </div>
                <div className="flex items-center space-x-3 text-sm">
                  <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
                  <span className="text-gray-600">18분 전</span>
                  <span>대량 세션 로그아웃이 감지되었습니다</span>
                </div>
                <div className="flex items-center space-x-3 text-sm">
                  <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                  <span className="text-gray-600">25분 전</span>
                  <span>새 테넌트가 등록되었습니다</span>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-gray-200">
                <Link href="/audit-dashboard" className="text-blue-600 hover:text-blue-800 text-sm font-medium">
                  모든 활동 보기 →
                </Link>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow">
            <div className="p-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">⚠️ 주의 사항</h3>
            </div>
            <div className="p-4">
              <div className="space-y-3">
                <div className="flex items-start space-x-3">
                  <div className="w-2 h-2 bg-red-500 rounded-full mt-2"></div>
                  <div>
                    <p className="text-sm font-medium text-red-800">높은 오류율 감지</p>
                    <p className="text-xs text-red-600">지난 1시간 동안 오류율이 증가했습니다</p>
                  </div>
                </div>
                <div className="flex items-start space-x-3">
                  <div className="w-2 h-2 bg-yellow-500 rounded-full mt-2"></div>
                  <div>
                    <p className="text-sm font-medium text-yellow-800">메모리 사용량 증가</p>
                    <p className="text-xs text-yellow-600">메모리 사용량이 70%를 초과했습니다</p>
                  </div>
                </div>
                <div className="flex items-start space-x-3">
                  <div className="w-2 h-2 bg-blue-500 rounded-full mt-2"></div>
                  <div>
                    <p className="text-sm font-medium text-blue-800">정책 업데이트 권장</p>
                    <p className="text-xs text-blue-600">일부 ABAC 정책을 검토해 주세요</p>
                  </div>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-gray-200">
                <Link href="/error-dashboard" className="text-red-600 hover:text-red-800 text-sm font-medium">
                  자세한 분석 보기 →
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 pt-6 border-t border-gray-200 text-center text-sm text-gray-500">
          <p>Keyfront BFF v{stats?.system.version} • {stats?.system.environment} 환경</p>
          <p className="mt-1">
            마지막 재시작: {stats?.system.lastRestart ? new Date(stats.system.lastRestart).toLocaleString() : 'N/A'}
          </p>
        </div>
      </div>
    </div>
  );
}