'use client';

import { useState, useEffect } from 'react';

interface AuditLog {
  id: string;
  timestamp: string;
  tenantId: string;
  userId: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  result: 'allow' | 'deny' | 'error';
  reason?: string;
  metadata?: Record<string, any>;
  traceId: string;
  ipAddress?: string;
  userAgent?: string;
}

interface AuditStats {
  summary: {
    totalEvents: number;
    securityEvents: number;
    allowedEvents: number;
    deniedEvents: number;
    errorEvents: number;
    uniqueUsers: number;
    uniqueTenants: number;
  };
  timeSeries: Array<{ time: string; count: number }>;
  topActions: Array<{ action: string; count: number }>;
  topUsers: Array<{ userId: string; count: number }>;
  topResourceTypes: Array<{ resourceType: string; count: number }>;
  resultDistribution: Array<{ result: string; count: number }>;
  securityStats: {
    totalThreats: number;
    threatsByType: Array<{ type: string; count: number }>;
    threatsBySeverity: Array<{ severity: string; count: number }>;
  };
}

interface AuditResponse {
  logs: AuditLog[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export default function AuditDashboard() {
  const [stats, setStats] = useState<AuditStats | null>(null);
  const [logs, setLogs] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'logs' | 'security'>('overview');
  const [filters, setFilters] = useState({
    startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    action: '',
    userId: '',
    result: '',
    resourceType: '',
  });
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    loadStats();
    if (activeTab === 'logs') {
      loadLogs();
    }
  }, [activeTab, filters, currentPage]);

  const loadStats = async () => {
    try {
      const params = new URLSearchParams({
        startDate: filters.startDate,
        endDate: filters.endDate,
        groupBy: 'day',
      });

      const response = await fetch(`/api/audit/stats?${params}`, {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        setStats(data.data);
      }
    } catch (error) {
      console.error('Failed to load audit stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadLogs = async () => {
    try {
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: '20',
        ...(filters.startDate && { startDate: filters.startDate }),
        ...(filters.endDate && { endDate: filters.endDate }),
        ...(filters.action && { action: filters.action }),
        ...(filters.userId && { userId: filters.userId }),
        ...(filters.result && { result: filters.result }),
        ...(filters.resourceType && { resourceType: filters.resourceType }),
      });

      const response = await fetch(`/api/audit/logs?${params}`, {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        setLogs(data.data);
      }
    } catch (error) {
      console.error('Failed to load audit logs:', error);
    }
  };

  const getResultColor = (result: string) => {
    switch (result) {
      case 'allow': return 'text-green-600 bg-green-100';
      case 'deny': return 'text-red-600 bg-red-100';
      case 'error': return 'text-orange-600 bg-orange-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const getResultIcon = (result: string) => {
    switch (result) {
      case 'allow': return '✅';
      case 'deny': return '❌';
      case 'error': return '⚠️';
      default: return '❓';
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'text-red-600 bg-red-100';
      case 'high': return 'text-orange-600 bg-orange-100';
      case 'medium': return 'text-yellow-600 bg-yellow-100';
      case 'low': return 'text-blue-600 bg-blue-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">감사 로그 로드 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            🔍 감사 로그 대시보드
          </h1>
          <div className="flex items-center space-x-4">
            <button
              onClick={() => {
                loadStats();
                if (activeTab === 'logs') loadLogs();
              }}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            >
              🔄 새로고침
            </button>
          </div>
        </div>

        {/* 필터 */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">📊 필터 및 검색</h3>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">시작 날짜</label>
              <input
                type="date"
                value={filters.startDate}
                onChange={(e) => setFilters(prev => ({ ...prev, startDate: e.target.value }))}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">종료 날짜</label>
              <input
                type="date"
                value={filters.endDate}
                onChange={(e) => setFilters(prev => ({ ...prev, endDate: e.target.value }))}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">액션</label>
              <input
                type="text"
                value={filters.action}
                onChange={(e) => setFilters(prev => ({ ...prev, action: e.target.value }))}
                placeholder="예: login_attempt"
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">사용자 ID</label>
              <input
                type="text"
                value={filters.userId}
                onChange={(e) => setFilters(prev => ({ ...prev, userId: e.target.value }))}
                placeholder="사용자 ID"
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">결과</label>
              <select
                value={filters.result}
                onChange={(e) => setFilters(prev => ({ ...prev, result: e.target.value }))}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
              >
                <option value="">전체</option>
                <option value="allow">허용</option>
                <option value="deny">거부</option>
                <option value="error">오류</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">리소스 타입</label>
              <input
                type="text"
                value={filters.resourceType}
                onChange={(e) => setFilters(prev => ({ ...prev, resourceType: e.target.value }))}
                placeholder="예: session"
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>

        {/* 탭 네비게이션 */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="flex space-x-8">
            {[
              { key: 'overview', label: '📊 개요', icon: '📊' },
              { key: 'logs', label: '📜 로그', icon: '📜' },
              { key: 'security', label: '🛡️ 보안', icon: '🛡️' },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as any)}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === tab.key
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* 개요 탭 */}
        {activeTab === 'overview' && stats && (
          <div className="space-y-6">
            {/* 요약 통계 */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="bg-white rounded-lg shadow p-6">
                <div className="text-2xl font-bold text-blue-600">
                  {stats.summary.totalEvents.toLocaleString()}
                </div>
                <div className="text-sm text-blue-700">총 이벤트</div>
              </div>
              <div className="bg-white rounded-lg shadow p-6">
                <div className="text-2xl font-bold text-green-600">
                  {stats.summary.allowedEvents.toLocaleString()}
                </div>
                <div className="text-sm text-green-700">허용된 요청</div>
              </div>
              <div className="bg-white rounded-lg shadow p-6">
                <div className="text-2xl font-bold text-red-600">
                  {stats.summary.deniedEvents.toLocaleString()}
                </div>
                <div className="text-sm text-red-700">거부된 요청</div>
              </div>
              <div className="bg-white rounded-lg shadow p-6">
                <div className="text-2xl font-bold text-orange-600">
                  {stats.summary.securityEvents.toLocaleString()}
                </div>
                <div className="text-sm text-orange-700">보안 이벤트</div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* 상위 액션 */}
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold mb-4">🎯 상위 액션</h3>
                <div className="space-y-3">
                  {stats.topActions.slice(0, 10).map((item, index) => (
                    <div key={index} className="flex justify-between items-center">
                      <span className="text-sm font-mono">{item.action}</span>
                      <span className="text-sm font-semibold">{item.count.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 결과 분포 */}
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold mb-4">📈 결과 분포</h3>
                <div className="space-y-3">
                  {stats.resultDistribution.map((item, index) => {
                    const percentage = (item.count / stats.summary.totalEvents) * 100;
                    return (
                      <div key={index}>
                        <div className="flex justify-between items-center mb-1">
                          <span className={`px-2 py-1 rounded text-xs ${getResultColor(item.result)}`}>
                            {getResultIcon(item.result)} {item.result}
                          </span>
                          <span className="text-sm font-semibold">
                            {item.count.toLocaleString()} ({percentage.toFixed(1)}%)
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div 
                            className={`h-2 rounded-full ${
                              item.result === 'allow' ? 'bg-green-500' :
                              item.result === 'deny' ? 'bg-red-500' : 'bg-orange-500'
                            }`}
                            style={{ width: `${percentage}%` }}
                          ></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 로그 탭 */}
        {activeTab === 'logs' && logs && (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold">📜 감사 로그</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      시간
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      사용자
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      액션
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      리소스
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      결과
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      추적 ID
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {logs.logs.map((log, index) => (
                    <tr key={index} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <div>
                          <div className="font-medium">{log.userId}</div>
                          <div className="text-gray-500">{log.tenantId}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-mono">
                        {log.action}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <div>
                          <div className="font-medium">{log.resourceType}</div>
                          {log.resourceId && (
                            <div className="text-gray-500 text-xs">{log.resourceId}</div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 rounded text-xs ${getResultColor(log.result)}`}>
                          {getResultIcon(log.result)} {log.result}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-500">
                        {log.traceId}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            {/* 페이지네이션 */}
            <div className="px-6 py-4 border-t border-gray-200 flex justify-between items-center">
              <div className="text-sm text-gray-700">
                총 {logs.pagination.total.toLocaleString()}개 중 {logs.pagination.page}페이지
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1 border border-gray-300 rounded text-sm disabled:opacity-50"
                >
                  이전
                </button>
                <button
                  onClick={() => setCurrentPage(Math.min(logs.pagination.totalPages, currentPage + 1))}
                  disabled={currentPage === logs.pagination.totalPages}
                  className="px-3 py-1 border border-gray-300 rounded text-sm disabled:opacity-50"
                >
                  다음
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 보안 탭 */}
        {activeTab === 'security' && stats && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* 위협 타입별 */}
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold mb-4">🎯 위협 타입별 분포</h3>
                <div className="space-y-3">
                  {stats.securityStats.threatsByType.map((item, index) => (
                    <div key={index} className="flex justify-between items-center">
                      <span className="text-sm font-medium">{item.type}</span>
                      <span className="text-sm font-semibold">{item.count.toLocaleString()}</span>
                    </div>
                  ))}
                  {stats.securityStats.threatsByType.length === 0 && (
                    <div className="text-center text-gray-500 py-8">
                      보안 위협이 감지되지 않았습니다.
                    </div>
                  )}
                </div>
              </div>

              {/* 위협 심각도별 */}
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold mb-4">⚠️ 위협 심각도별 분포</h3>
                <div className="space-y-3">
                  {stats.securityStats.threatsBySeverity.map((item, index) => (
                    <div key={index} className="flex justify-between items-center">
                      <span className={`px-2 py-1 rounded text-xs ${getSeverityColor(item.severity)}`}>
                        {item.severity}
                      </span>
                      <span className="text-sm font-semibold">{item.count.toLocaleString()}</span>
                    </div>
                  ))}
                  {stats.securityStats.threatsBySeverity.length === 0 && (
                    <div className="text-center text-gray-500 py-8">
                      보안 위협이 감지되지 않았습니다.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}