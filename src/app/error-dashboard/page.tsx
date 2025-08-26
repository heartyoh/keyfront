'use client';

import { useState, useEffect } from 'react';
import { ErrorEvent, ErrorGroup, ErrorStats } from '@/services/error-tracking';

interface ErrorStatsResponse {
  tenantId: string;
  period: {
    days: number;
    generatedAt: string;
  };
  stats: ErrorStats;
}

interface ErrorGroupsResponse {
  groups: ErrorGroup[];
  total: number;
}

interface ErrorsResponse {
  errors: ErrorEvent[];
  total: number;
}

export default function ErrorDashboard() {
  const [stats, setStats] = useState<ErrorStatsResponse | null>(null);
  const [errorGroups, setErrorGroups] = useState<ErrorGroup[]>([]);
  const [recentErrors, setRecentErrors] = useState<ErrorEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'groups' | 'recent' | 'alerts'>('overview');
  const [selectedGroup, setSelectedGroup] = useState<ErrorGroup | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    loadErrorData();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      loadErrorData();
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [autoRefresh]);

  const loadErrorData = async () => {
    try {
      // Load error statistics
      const statsResponse = await fetch('/api/errors/stats?days=7', {
        credentials: 'include'
      });
      if (statsResponse.ok) {
        const statsData = await statsResponse.json();
        setStats(statsData.data);
      }

      // Load error groups
      const groupsResponse = await fetch('/api/errors/groups?limit=50', {
        credentials: 'include'
      });
      if (groupsResponse.ok) {
        const groupsData = await groupsResponse.json();
        setErrorGroups(groupsData.data.groups);
      }

      // Load recent errors
      const errorsResponse = await fetch('/api/errors?limit=50', {
        credentials: 'include'
      });
      if (errorsResponse.ok) {
        const errorsData = await errorsResponse.json();
        setRecentErrors(errorsData.data.errors);
      }
    } catch (error) {
      console.error('Failed to load error data:', error);
    } finally {
      setLoading(false);
    }
  };

  const resolveErrorGroup = async (fingerprint: string) => {
    try {
      const response = await fetch('/api/errors/groups', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ fingerprint }),
      });

      if (response.ok) {
        // Refresh data
        loadErrorData();
        setSelectedGroup(null);
      }
    } catch (error) {
      console.error('Failed to resolve error group:', error);
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-800';
      case 'high': return 'bg-orange-100 text-orange-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'low': return 'bg-blue-100 text-blue-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical': return '🚨';
      case 'high': return '⚠️';
      case 'medium': return '⚡';
      case 'low': return 'ℹ️';
      default: return '❓';
    }
  };

  const formatTimeAgo = (timestamp: string) => {
    const diff = Date.now() - new Date(timestamp).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (days > 0) return `${days}일 전`;
    if (hours > 0) return `${hours}시간 전`;
    if (minutes > 0) return `${minutes}분 전`;
    return '방금 전';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">에러 데이터 로드 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            🚨 에러 모니터링 대시보드
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
            <button
              onClick={loadErrorData}
              className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
            >
              🔄 새로고침
            </button>
          </div>
        </div>

        {/* 에러 통계 요약 */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center">
                <div className="text-2xl font-bold text-red-600">
                  {stats.stats.totalErrors}
                </div>
                <div className="ml-2">🚨</div>
              </div>
              <div className="text-sm text-red-700">총 에러</div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center">
                <div className="text-2xl font-bold text-orange-600">
                  {stats.stats.newErrors}
                </div>
                <div className="ml-2">🆕</div>
              </div>
              <div className="text-sm text-orange-700">미해결 에러</div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center">
                <div className="text-2xl font-bold text-green-600">
                  {stats.stats.resolvedErrors}
                </div>
                <div className="ml-2">✅</div>
              </div>
              <div className="text-sm text-green-700">해결된 에러</div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center">
                <div className="text-2xl font-bold text-blue-600">
                  {Object.keys(stats.stats.errorsByType).length}
                </div>
                <div className="ml-2">📊</div>
              </div>
              <div className="text-sm text-blue-700">에러 타입</div>
            </div>
          </div>
        )}

        {/* 탭 네비게이션 */}
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex">
              {[
                { id: 'overview', name: '📊 개요' },
                { id: 'groups', name: '📁 그룹' },
                { id: 'recent', name: '🕒 최근 에러' },
                { id: 'alerts', name: '🔔 알림' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`py-2 px-4 border-b-2 font-medium text-sm ${
                    activeTab === tab.id
                      ? 'border-red-500 text-red-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  {tab.name}
                </button>
              ))}
            </nav>
          </div>

          <div className="p-6">
            {activeTab === 'overview' && stats && (
              <div>
                <h3 className="text-lg font-semibold mb-4">에러 개요</h3>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div>
                    <h4 className="font-semibold mb-3">에러 타입별 분포</h4>
                    <div className="space-y-2">
                      {Object.entries(stats.stats.errorsByType)
                        .sort(([,a], [,b]) => b - a)
                        .slice(0, 10)
                        .map(([type, count]) => {
                          const percentage = (count / stats.stats.totalErrors) * 100;
                          return (
                            <div key={type}>
                              <div className="flex justify-between items-center mb-1">
                                <span className="text-sm font-medium">{type}</span>
                                <span className="text-sm text-gray-600">{count} ({percentage.toFixed(1)}%)</span>
                              </div>
                              <div className="w-full bg-gray-200 rounded-full h-2">
                                <div 
                                  className="bg-red-500 h-2 rounded-full"
                                  style={{ width: `${percentage}%` }}
                                ></div>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>

                  <div>
                    <h4 className="font-semibold mb-3">심각도별 분포</h4>
                    <div className="space-y-3">
                      {Object.entries(stats.stats.errorsBySeverity).map(([severity, count]) => (
                        <div key={severity} className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <span>{getSeverityIcon(severity)}</span>
                            <span className={`px-2 py-1 rounded text-sm ${getSeverityColor(severity)}`}>
                              {severity}
                            </span>
                          </div>
                          <div className="text-lg font-semibold">{count}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-6">
                  <h4 className="font-semibold mb-3">상위 에러 그룹</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left py-2">에러</th>
                          <th className="text-left py-2">타입</th>
                          <th className="text-left py-2">심각도</th>
                          <th className="text-right py-2">발생 횟수</th>
                          <th className="text-right py-2">최근 발생</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.stats.topErrors.slice(0, 10).map((group, index) => (
                          <tr key={group.fingerprint} className="border-b border-gray-100">
                            <td className="py-2">
                              <div className="font-mono text-sm text-red-600">
                                {group.message.substring(0, 50)}...
                              </div>
                            </td>
                            <td className="py-2">
                              <span className="px-2 py-1 bg-gray-100 rounded text-xs">
                                {group.type}
                              </span>
                            </td>
                            <td className="py-2">
                              <span className={`px-2 py-1 rounded text-xs ${getSeverityColor(group.severity)}`}>
                                {getSeverityIcon(group.severity)} {group.severity}
                              </span>
                            </td>
                            <td className="py-2 text-right font-semibold">{group.count}</td>
                            <td className="py-2 text-right text-sm text-gray-600">
                              {formatTimeAgo(group.lastSeen)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'groups' && (
              <div>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold">에러 그룹</h3>
                  <div className="text-sm text-gray-600">
                    총 {errorGroups.length}개의 그룹
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div>
                    <div className="space-y-3 max-h-96 overflow-y-auto">
                      {errorGroups.map((group) => (
                        <div
                          key={group.fingerprint}
                          className={`p-4 border rounded cursor-pointer hover:bg-gray-50 ${
                            selectedGroup?.fingerprint === group.fingerprint ? 'border-red-500 bg-red-50' : 'border-gray-200'
                          } ${group.resolved ? 'opacity-60' : ''}`}
                          onClick={() => setSelectedGroup(group)}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center space-x-2">
                              <span className={`px-2 py-1 rounded text-xs ${getSeverityColor(group.severity)}`}>
                                {getSeverityIcon(group.severity)} {group.severity}
                              </span>
                              {group.resolved && (
                                <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs">
                                  ✅ 해결됨
                                </span>
                              )}
                            </div>
                            <div className="text-lg font-bold text-red-600">{group.count}</div>
                          </div>
                          <div className="font-mono text-sm text-gray-800 mb-2">
                            {group.message.substring(0, 60)}...
                          </div>
                          <div className="flex items-center justify-between text-xs text-gray-600">
                            <span>{group.type}</span>
                            <span>{formatTimeAgo(group.lastSeen)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    {selectedGroup ? (
                      <div className="bg-gray-50 p-4 rounded">
                        <div className="flex items-center justify-between mb-4">
                          <h4 className="font-semibold">에러 상세 정보</h4>
                          {!selectedGroup.resolved && (
                            <button
                              onClick={() => resolveErrorGroup(selectedGroup.fingerprint)}
                              className="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700"
                            >
                              ✅ 해결 처리
                            </button>
                          )}
                        </div>

                        <div className="space-y-3 text-sm">
                          <div>
                            <strong>메시지:</strong>
                            <div className="font-mono bg-white p-2 rounded mt-1">
                              {selectedGroup.message}
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            <div><strong>타입:</strong> {selectedGroup.type}</div>
                            <div><strong>심각도:</strong> 
                              <span className={`ml-1 px-2 py-1 rounded text-xs ${getSeverityColor(selectedGroup.severity)}`}>
                                {selectedGroup.severity}
                              </span>
                            </div>
                            <div><strong>발생 횟수:</strong> {selectedGroup.count}</div>
                            <div><strong>영향받은 사용자:</strong> {selectedGroup.affectedUsers.length}</div>
                            <div><strong>첫 발생:</strong> {new Date(selectedGroup.firstSeen).toLocaleString()}</div>
                            <div><strong>최근 발생:</strong> {new Date(selectedGroup.lastSeen).toLocaleString()}</div>
                          </div>

                          {selectedGroup.sample.stack && (
                            <div>
                              <strong>스택 트레이스:</strong>
                              <div className="bg-gray-900 text-green-400 p-3 rounded mt-1 max-h-48 overflow-y-auto">
                                <pre className="text-xs">{selectedGroup.sample.stack}</pre>
                              </div>
                            </div>
                          )}

                          {selectedGroup.tags.length > 0 && (
                            <div>
                              <strong>태그:</strong>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {selectedGroup.tags.map((tag, index) => (
                                  <span key={index} className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="bg-gray-50 p-8 rounded text-center text-gray-600">
                        에러 그룹을 선택하여 상세 정보를 확인하세요
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'recent' && (
              <div>
                <h3 className="text-lg font-semibold mb-4">최근 에러 (최근 24시간)</h3>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-2">시간</th>
                        <th className="text-left py-2">메시지</th>
                        <th className="text-left py-2">타입</th>
                        <th className="text-left py-2">심각도</th>
                        <th className="text-left py-2">사용자</th>
                        <th className="text-left py-2">경로</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentErrors.map((error) => (
                        <tr key={error.id} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-2 text-sm">
                            {new Date(error.timestamp).toLocaleString()}
                          </td>
                          <td className="py-2">
                            <div className="font-mono text-sm text-red-600 max-w-xs truncate">
                              {error.message}
                            </div>
                          </td>
                          <td className="py-2">
                            <span className="px-2 py-1 bg-gray-100 rounded text-xs">
                              {error.type}
                            </span>
                          </td>
                          <td className="py-2">
                            <span className={`px-2 py-1 rounded text-xs ${getSeverityColor(error.severity)}`}>
                              {getSeverityIcon(error.severity)} {error.severity}
                            </span>
                          </td>
                          <td className="py-2 text-sm text-gray-600">
                            {error.userId?.substring(0, 8) || '익명'}
                          </td>
                          <td className="py-2 text-sm text-gray-600">
                            {error.context.route || error.context.url || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {recentErrors.length === 0 && (
                    <div className="text-center py-8 text-gray-600">
                      최근 24시간 동안 에러가 없습니다 🎉
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'alerts' && (
              <div>
                <h3 className="text-lg font-semibold mb-4">알림 설정</h3>
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <div className="flex items-center space-x-2">
                    <span className="text-yellow-600">⚠️</span>
                    <div>
                      <h4 className="font-medium text-yellow-800">알림 시스템 구현 필요</h4>
                      <p className="text-sm text-yellow-700">
                        에러 발생 시 자동 알림을 위한 설정 기능이 곧 추가될 예정입니다.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}