'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { LogoutEvent, ClientRegistration } from '@/types/backchannel-logout';

interface LogoutStats {
  totalLogoutEvents: number;
  successfulLogouts: number;
  activeSessions: number;
  registeredClients: number;
  averageLogoutTime: number;
  notificationSuccessRate: number;
}

export default function BackchannelLogoutManagement() {
  const [logoutEvents, setLogoutEvents] = useState<LogoutEvent[]>([]);
  const [clients, setClients] = useState<ClientRegistration[]>([]);
  const [stats, setStats] = useState<LogoutStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<LogoutEvent | null>(null);
  const [activeTab, setActiveTab] = useState<'events' | 'clients' | 'emergency'>('events');

  useEffect(() => {
    loadLogoutData();
  }, []);

  const loadLogoutData = async () => {
    try {
      // Load logout events
      const eventsResponse = await fetch('/api/logout/backchannel/events?limit=50', {
        credentials: 'include'
      });
      if (eventsResponse.ok) {
        const eventsData = await eventsResponse.json();
        setLogoutEvents(eventsData.data.events || []);
      }

      // Load registered clients
      const clientsResponse = await fetch('/api/logout/clients', {
        credentials: 'include'
      });
      if (clientsResponse.ok) {
        const clientsData = await clientsResponse.json();
        setClients(clientsData.data.clients || []);
      }

      // Mock stats - in production, load from actual API
      const mockStats: LogoutStats = {
        totalLogoutEvents: 143,
        successfulLogouts: 138,
        activeSessions: 89,
        registeredClients: 12,
        averageLogoutTime: 1250,
        notificationSuccessRate: 96.5,
      };
      setStats(mockStats);
    } catch (error) {
      console.error('Failed to load logout data:', error);
    } finally {
      setLoading(false);
    }
  };

  const initiateEmergencyLogout = async () => {
    if (!confirm('모든 사용자를 즉시 로그아웃시키겠습니까? 이 작업은 되돌릴 수 없습니다.')) {
      return;
    }

    try {
      const response = await fetch('/api/logout/emergency', {
        method: 'POST',
        credentials: 'include',
      });

      if (response.ok) {
        alert('비상 로그아웃이 시작되었습니다.');
        await loadLogoutData();
      }
    } catch (error) {
      console.error('Emergency logout failed:', error);
      alert('비상 로그아웃에 실패했습니다.');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-800';
      case 'in_progress': return 'bg-blue-100 text-blue-800';
      case 'failed': return 'bg-red-100 text-red-800';
      case 'partial': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getTriggerIcon = (trigger: string) => {
    switch (trigger) {
      case 'user_action': return '👤';
      case 'admin_action': return '👨‍💼';
      case 'system_timeout': return '⏰';
      case 'security_policy': return '🛡️';
      case 'external_request': return '🌐';
      default: return '❓';
    }
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}초`;
    return `${(ms / 60000).toFixed(1)}분`;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">로그아웃 데이터 로드 중...</p>
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
              <div className="flex items-center space-x-2 mb-2">
                <Link href="/admin" className="text-blue-600 hover:text-blue-800">관리 센터</Link>
                <span className="text-gray-400">→</span>
                <span className="text-gray-900">Back-channel 로그아웃</span>
              </div>
              <h1 className="text-2xl font-bold text-gray-900">
                🚪 중앙 집중식 세션 관리
              </h1>
              <p className="text-sm text-gray-600">
                OpenID Connect Back-Channel Logout 구현
              </p>
            </div>
            <div className="flex space-x-2">
              <button
                onClick={initiateEmergencyLogout}
                className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
              >
                🚨 비상 로그아웃
              </button>
              <button className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
                ➕ 클라이언트 등록
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Stats Overview */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-2xl font-bold text-blue-600">{stats.totalLogoutEvents}</div>
              <div className="text-sm text-blue-700">총 로그아웃</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-2xl font-bold text-green-600">{stats.successfulLogouts}</div>
              <div className="text-sm text-green-700">성공</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-2xl font-bold text-purple-600">{stats.activeSessions}</div>
              <div className="text-sm text-purple-700">활성 세션</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-2xl font-bold text-orange-600">{stats.registeredClients}</div>
              <div className="text-sm text-orange-700">등록 클라이언트</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-2xl font-bold text-indigo-600">{formatDuration(stats.averageLogoutTime)}</div>
              <div className="text-sm text-indigo-700">평균 시간</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-2xl font-bold text-cyan-600">{stats.notificationSuccessRate}%</div>
              <div className="text-sm text-cyan-700">알림 성공률</div>
            </div>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex">
              {[
                { id: 'events', name: '🕐 로그아웃 이벤트' },
                { id: 'clients', name: '🖥️ 클라이언트 관리' },
                { id: 'emergency', name: '🚨 비상 관리' },
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
            {activeTab === 'events' && (
              <div>
                <h3 className="text-lg font-semibold mb-4">최근 로그아웃 이벤트</h3>
                
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    {logoutEvents.map((event) => (
                      <div
                        key={event.id}
                        className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                          selectedEvent?.id === event.id
                            ? 'border-red-500 bg-red-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                        onClick={() => setSelectedEvent(event)}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center space-x-2">
                            <span className="text-lg">{getTriggerIcon(event.trigger)}</span>
                            <span className="font-medium text-sm">{event.trigger.replace('_', ' ')}</span>
                          </div>
                          <span className={`px-2 py-1 rounded text-xs ${getStatusColor(event.status)}`}>
                            {event.status}
                          </span>
                        </div>
                        
                        <div className="text-sm text-gray-600 mb-2">
                          사용자: {event.user_id} • 세션: {event.affected_sessions.length}개
                        </div>
                        
                        <div className="flex items-center justify-between text-xs text-gray-500">
                          <span>알림: {event.notification_results.length}개</span>
                          <span>{new Date(event.timestamp).toLocaleString()}</span>
                        </div>
                      </div>
                    ))}

                    {logoutEvents.length === 0 && (
                      <div className="text-center py-8 text-gray-500">
                        <div className="text-4xl mb-2">🚪</div>
                        <p>최근 로그아웃 이벤트가 없습니다.</p>
                      </div>
                    )}
                  </div>

                  <div>
                    {selectedEvent ? (
                      <div className="border border-gray-200 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-4">
                          <h4 className="font-semibold text-lg">로그아웃 상세 정보</h4>
                          <span className={`px-3 py-1 rounded ${getStatusColor(selectedEvent.status)}`}>
                            {selectedEvent.status}
                          </span>
                        </div>

                        <div className="space-y-4">
                          <div>
                            <h5 className="font-medium text-gray-700 mb-2">기본 정보</h5>
                            <div className="bg-gray-50 rounded p-3 text-sm space-y-1">
                              <div><strong>이벤트 ID:</strong> {selectedEvent.id}</div>
                              <div><strong>추적 ID:</strong> {selectedEvent.traceId}</div>
                              <div><strong>사용자 ID:</strong> {selectedEvent.user_id}</div>
                              <div><strong>세션 ID:</strong> {selectedEvent.session_id}</div>
                              <div><strong>트리거:</strong> {selectedEvent.trigger}</div>
                              <div><strong>이벤트 타입:</strong> {selectedEvent.event_type}</div>
                            </div>
                          </div>

                          <div>
                            <h5 className="font-medium text-gray-700 mb-2">영향받은 세션</h5>
                            <div className="bg-gray-50 rounded p-3">
                              <div className="text-sm">
                                <strong>총 {selectedEvent.affected_sessions.length}개 세션</strong>
                              </div>
                              {selectedEvent.affected_sessions.slice(0, 3).map((sessionId, index) => (
                                <div key={index} className="text-xs text-gray-600 font-mono mt-1">
                                  {sessionId}
                                </div>
                              ))}
                              {selectedEvent.affected_sessions.length > 3 && (
                                <div className="text-xs text-gray-500 mt-1">
                                  ...및 {selectedEvent.affected_sessions.length - 3}개 더
                                </div>
                              )}
                            </div>
                          </div>

                          <div>
                            <h5 className="font-medium text-gray-700 mb-2">알림 결과</h5>
                            <div className="space-y-2 max-h-32 overflow-y-auto">
                              {selectedEvent.notification_results.map((result, index) => (
                                <div key={index} className="bg-gray-50 rounded p-2 text-sm">
                                  <div className="flex items-center justify-between">
                                    <span className="font-medium">{result.client_id}</span>
                                    <span className={`px-2 py-1 rounded text-xs ${
                                      result.status === 'acknowledged' ? 'bg-green-100 text-green-800' :
                                      result.status === 'failed' ? 'bg-red-100 text-red-800' :
                                      'bg-yellow-100 text-yellow-800'
                                    }`}>
                                      {result.status}
                                    </span>
                                  </div>
                                  {result.error_description && (
                                    <div className="text-xs text-red-600 mt-1">
                                      {result.error_description}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>

                          {selectedEvent.initiator && (
                            <div>
                              <h5 className="font-medium text-gray-700 mb-2">시작자 정보</h5>
                              <div className="bg-gray-50 rounded p-3 text-sm">
                                <div><strong>사용자:</strong> {selectedEvent.initiator.user_id || '시스템'}</div>
                                <div><strong>클라이언트:</strong> {selectedEvent.initiator.client_id || 'N/A'}</div>
                                <div><strong>IP 주소:</strong> {selectedEvent.initiator.ip_address || 'N/A'}</div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="border border-gray-200 rounded-lg p-8 text-center text-gray-500">
                        <div className="text-4xl mb-2">👈</div>
                        <p>이벤트를 선택하여 상세 정보를 확인하세요</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'clients' && (
              <div>
                <h3 className="text-lg font-semibold mb-4">등록된 클라이언트</h3>
                
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-2">클라이언트 ID</th>
                        <th className="text-left py-2">이름</th>
                        <th className="text-left py-2">Back-channel URI</th>
                        <th className="text-left py-2">알림 설정</th>
                        <th className="text-left py-2">상태</th>
                        <th className="text-left py-2">작업</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clients.map((client) => (
                        <tr key={client.client_id} className="border-b border-gray-100">
                          <td className="py-2 font-mono text-sm">{client.client_id}</td>
                          <td className="py-2">{client.client_name}</td>
                          <td className="py-2">
                            {client.backchannel_logout_uri ? (
                              <span className="text-xs font-mono bg-gray-100 px-2 py-1 rounded">
                                {client.backchannel_logout_uri.length > 30 ? 
                                  client.backchannel_logout_uri.substring(0, 30) + '...' :
                                  client.backchannel_logout_uri
                                }
                              </span>
                            ) : (
                              <span className="text-gray-400 text-sm">설정되지 않음</span>
                            )}
                          </td>
                          <td className="py-2">
                            <div className="text-sm">
                              <div>알림: {client.logout_notification_enabled ? '✅' : '❌'}</div>
                              <div>타임아웃: {client.logout_timeout_seconds}초</div>
                            </div>
                          </td>
                          <td className="py-2">
                            <span className={`px-2 py-1 rounded text-xs ${
                              client.enabled ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                            }`}>
                              {client.enabled ? '활성' : '비활성'}
                            </span>
                          </td>
                          <td className="py-2">
                            <div className="flex space-x-2">
                              <button className="text-blue-600 hover:text-blue-800 text-sm">편집</button>
                              <button className="text-red-600 hover:text-red-800 text-sm">삭제</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {clients.length === 0 && (
                    <div className="text-center py-8 text-gray-500">
                      <div className="text-4xl mb-2">🖥️</div>
                      <p>등록된 클라이언트가 없습니다.</p>
                      <button className="mt-2 text-blue-600 hover:text-blue-800 font-medium">
                        첫 번째 클라이언트 등록하기
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'emergency' && (
              <div>
                <h3 className="text-lg font-semibold mb-4">비상 세션 관리</h3>
                
                <div className="bg-red-50 border border-red-200 rounded-lg p-6 mb-6">
                  <div className="flex items-center space-x-3 mb-4">
                    <span className="text-red-600 text-2xl">🚨</span>
                    <div>
                      <h4 className="font-semibold text-red-800">비상 로그아웃</h4>
                      <p className="text-sm text-red-700">
                        보안 사고 발생 시 모든 사용자를 즉시 로그아웃시킵니다.
                      </p>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                      <h5 className="font-medium text-red-800 mb-2">영향</h5>
                      <ul className="text-sm text-red-700 space-y-1">
                        <li>• 모든 활성 세션 즉시 종료</li>
                        <li>• 모든 등록된 클라이언트에 알림</li>
                        <li>• 리프레시 토큰 무효화</li>
                        <li>• 사용자 재인증 필요</li>
                      </ul>
                    </div>
                    <div>
                      <h5 className="font-medium text-red-800 mb-2">주의사항</h5>
                      <ul className="text-sm text-red-700 space-y-1">
                        <li>• 이 작업은 되돌릴 수 없습니다</li>
                        <li>• 모든 진행 중인 작업이 중단됩니다</li>
                        <li>• 시스템 전체에 영향을 줍니다</li>
                        <li>• 감사 로그에 기록됩니다</li>
                      </ul>
                    </div>
                  </div>
                  
                  <button
                    onClick={initiateEmergencyLogout}
                    className="bg-red-600 text-white px-6 py-3 rounded font-semibold hover:bg-red-700"
                  >
                    🚨 비상 로그아웃 실행
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <h4 className="font-medium mb-3">현재 시스템 상태</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span>활성 세션:</span>
                        <span className="font-semibold">{stats?.activeSessions || 0}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>등록된 클라이언트:</span>
                        <span className="font-semibold">{stats?.registeredClients || 0}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>알림 성공률:</span>
                        <span className="font-semibold">{stats?.notificationSuccessRate || 0}%</span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <h4 className="font-medium mb-3">비상 정책 상태</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span>비상 정책:</span>
                        <span className="px-2 py-1 bg-red-100 text-red-800 rounded text-xs">비활성화</span>
                      </div>
                      <div className="flex justify-between">
                        <span>최대 알림 대기:</span>
                        <span className="font-semibold">10초</span>
                      </div>
                      <div className="flex justify-between">
                        <span>강제 종료:</span>
                        <span className="font-semibold">예</span>
                      </div>
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