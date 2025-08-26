'use client';

import { useState, useEffect } from 'react';
import { TenantConfiguration, TenantUsageStats } from '@/types/tenant';

interface TenantConfigurationResponse {
  tenants: TenantConfiguration[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface TenantUsageResponse {
  tenantId: string;
  period: {
    start: string;
    end: string;
    days: number;
  };
  summary: {
    totals: {
      requests: { total: number; successful: number; failed: number; rateLimited: number };
      bandwidth: { inbound: number; outbound: number };
      sessions: { total: number; peak: number };
      errors: { total: number };
    };
    averages: {
      requestsPerDay: number;
      successRate: number;
      errorRate: number;
      rateLimitRate: number;
    };
  };
  dailyStats: TenantUsageStats[];
}

export default function TenantDashboard() {
  const [tenants, setTenants] = useState<TenantConfiguration[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<TenantConfiguration | null>(null);
  const [tenantUsage, setTenantUsage] = useState<TenantUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'config' | 'usage'>('overview');
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    loadTenants();
  }, []);

  useEffect(() => {
    if (selectedTenant) {
      loadTenantUsage(selectedTenant.tenantId);
    }
  }, [selectedTenant]);

  const loadTenants = async () => {
    try {
      const response = await fetch('/api/tenants', {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        setTenants(data.data.tenants);
        if (data.data.tenants.length > 0 && !selectedTenant) {
          setSelectedTenant(data.data.tenants[0]);
        }
      }
    } catch (error) {
      console.error('Failed to load tenants:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadTenantUsage = async (tenantId: string) => {
    try {
      const response = await fetch(`/api/tenants/${tenantId}/usage?days=7`, {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        setTenantUsage(data.data);
      }
    } catch (error) {
      console.error('Failed to load tenant usage:', error);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800';
      case 'inactive': return 'bg-yellow-100 text-yellow-800';
      case 'suspended': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">테넌트 정보 로드 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            🏢 테넌트 관리 대시보드
          </h1>
          <button
            onClick={() => setShowCreateModal(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            ➕ 새 테넌트
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* 테넌트 목록 */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow">
              <div className="p-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold">테넌트 목록</h2>
              </div>
              <div className="max-h-96 overflow-y-auto">
                {tenants.map((tenant) => (
                  <div
                    key={tenant.id}
                    className={`p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 ${ 
                      selectedTenant?.id === tenant.id ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''
                    }`}
                    onClick={() => setSelectedTenant(tenant)}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-sm">{tenant.name}</div>
                        <div className="text-xs text-gray-500">{tenant.tenantId}</div>
                      </div>
                      <span className={`px-2 py-1 rounded text-xs ${getStatusColor(tenant.status)}`}>
                        {tenant.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 메인 컨텐츠 */}
          <div className="lg:col-span-3">
            {selectedTenant && (
              <>
                {/* 테넌트 정보 헤더 */}
                <div className="bg-white rounded-lg shadow p-6 mb-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-2xl font-bold text-gray-900">{selectedTenant.name}</h2>
                      <p className="text-gray-600">테넌트 ID: {selectedTenant.tenantId}</p>
                    </div>
                    <div className="flex items-center space-x-4">
                      <span className={`px-3 py-1 rounded ${getStatusColor(selectedTenant.status)}`}>
                        {selectedTenant.status}
                      </span>
                      <button className="bg-gray-500 text-white px-3 py-1 rounded hover:bg-gray-600">
                        ⚙️ 편집
                      </button>
                    </div>
                  </div>
                </div>

                {/* 탭 네비게이션 */}
                <div className="bg-white rounded-lg shadow mb-6">
                  <div className="border-b border-gray-200">
                    <nav className="-mb-px flex">
                      {[
                        { id: 'overview', name: '📊 개요' },
                        { id: 'config', name: '⚙️ 설정' },
                        { id: 'usage', name: '📈 사용량' },
                      ].map((tab) => (
                        <button
                          key={tab.id}
                          onClick={() => setActiveTab(tab.id as any)}
                          className={`py-2 px-4 border-b-2 font-medium text-sm ${
                            activeTab === tab.id
                              ? 'border-blue-500 text-blue-600'
                              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                          }`}
                        >
                          {tab.name}
                        </button>
                      ))}
                    </nav>
                  </div>

                  <div className="p-6">
                    {activeTab === 'overview' && (
                      <div>
                        <h3 className="text-lg font-semibold mb-4">테넌트 개요</h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                          <div className="bg-blue-50 p-4 rounded-lg">
                            <div className="text-2xl font-bold text-blue-600">
                              {tenantUsage?.summary.totals.requests.total || 0}
                            </div>
                            <div className="text-sm text-blue-700">총 요청</div>
                          </div>
                          <div className="bg-green-50 p-4 rounded-lg">
                            <div className="text-2xl font-bold text-green-600">
                              {tenantUsage?.summary.averages.successRate.toFixed(1) || 0}%
                            </div>
                            <div className="text-sm text-green-700">성공률</div>
                          </div>
                          <div className="bg-yellow-50 p-4 rounded-lg">
                            <div className="text-2xl font-bold text-yellow-600">
                              {tenantUsage?.summary.totals.sessions.peak || 0}
                            </div>
                            <div className="text-sm text-yellow-700">최대 동시 세션</div>
                          </div>
                          <div className="bg-purple-50 p-4 rounded-lg">
                            <div className="text-2xl font-bold text-purple-600">
                              {formatBytes(tenantUsage?.summary.totals.bandwidth.inbound + tenantUsage?.summary.totals.bandwidth.outbound || 0)}
                            </div>
                            <div className="text-sm text-purple-700">총 대역폭</div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div>
                            <h4 className="font-semibold mb-3">기능 상태</h4>
                            <div className="space-y-2">
                              {Object.entries(selectedTenant.features).map(([key, value]) => (
                                <div key={key} className="flex items-center justify-between">
                                  <span className="text-sm">{key.replace(/([A-Z])/g, ' $1').toLowerCase()}</span>
                                  <span className={`px-2 py-1 rounded text-xs ${
                                    value ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                  }`}>
                                    {value ? '활성화' : '비활성화'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div>
                            <h4 className="font-semibold mb-3">메타데이터</h4>
                            <div className="space-y-2 text-sm">
                              <div><strong>생성일:</strong> {new Date(selectedTenant.metadata.createdAt).toLocaleString()}</div>
                              <div><strong>수정일:</strong> {new Date(selectedTenant.metadata.updatedAt).toLocaleString()}</div>
                              <div><strong>버전:</strong> v{selectedTenant.metadata.version}</div>
                              <div><strong>태그:</strong> {selectedTenant.metadata.tags.join(', ') || '없음'}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {activeTab === 'config' && (
                      <div>
                        <h3 className="text-lg font-semibold mb-4">설정 관리</h3>
                        <div className="space-y-6">
                          <div>
                            <h4 className="font-semibold mb-2">CORS 설정</h4>
                            <div className="bg-gray-50 p-4 rounded">
                              <div className="grid grid-cols-2 gap-4 text-sm">
                                <div><strong>허용 도메인:</strong> {selectedTenant.corsConfig.origins.join(', ')}</div>
                                <div><strong>허용 메서드:</strong> {selectedTenant.corsConfig.methods.join(', ')}</div>
                                <div><strong>인증 포함:</strong> {selectedTenant.corsConfig.credentials ? '예' : '아니오'}</div>
                                <div><strong>캐시 시간:</strong> {selectedTenant.corsConfig.maxAge}초</div>
                              </div>
                            </div>
                          </div>

                          <div>
                            <h4 className="font-semibold mb-2">속도 제한</h4>
                            <div className="bg-gray-50 p-4 rounded">
                              <div className="grid grid-cols-2 gap-4 text-sm">
                                <div><strong>분당:</strong> {selectedTenant.rateLimits.perMinute} 요청</div>
                                <div><strong>시간당:</strong> {selectedTenant.rateLimits.perHour} 요청</div>
                                <div><strong>일일:</strong> {selectedTenant.rateLimits.perDay} 요청</div>
                                <div><strong>버스트:</strong> {selectedTenant.rateLimits.burst} 요청</div>
                              </div>
                            </div>
                          </div>

                          <div>
                            <h4 className="font-semibold mb-2">보안 설정</h4>
                            <div className="bg-gray-50 p-4 rounded">
                              <div className="grid grid-cols-2 gap-4 text-sm">
                                <div><strong>CSRF 보호:</strong> {selectedTenant.security.enableCsrfProtection ? '활성화' : '비활성화'}</div>
                                <div><strong>세션 타임아웃:</strong> {selectedTenant.security.sessionTimeout}초</div>
                                <div><strong>최대 동시 세션:</strong> {selectedTenant.security.maxConcurrentSessions}</div>
                                <div><strong>보안 헤더:</strong> {selectedTenant.security.requireSecureHeaders ? '활성화' : '비활성화'}</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {activeTab === 'usage' && tenantUsage && (
                      <div>
                        <h3 className="text-lg font-semibold mb-4">사용량 통계 (최근 7일)</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div>
                            <h4 className="font-semibold mb-3">요청 통계</h4>
                            <div className="bg-gray-50 p-4 rounded">
                              <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                  <span>성공:</span>
                                  <span className="text-green-600 font-medium">
                                    {tenantUsage.summary.totals.requests.successful}
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span>실패:</span>
                                  <span className="text-red-600 font-medium">
                                    {tenantUsage.summary.totals.requests.failed}
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span>제한됨:</span>
                                  <span className="text-yellow-600 font-medium">
                                    {tenantUsage.summary.totals.requests.rateLimited}
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span>일일 평균:</span>
                                  <span className="font-medium">
                                    {tenantUsage.summary.averages.requestsPerDay.toFixed(0)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div>
                            <h4 className="font-semibold mb-3">대역폭 사용량</h4>
                            <div className="bg-gray-50 p-4 rounded">
                              <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                  <span>수신:</span>
                                  <span className="font-medium">
                                    {formatBytes(tenantUsage.summary.totals.bandwidth.inbound)}
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span>송신:</span>
                                  <span className="font-medium">
                                    {formatBytes(tenantUsage.summary.totals.bandwidth.outbound)}
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span>총합:</span>
                                  <span className="font-medium">
                                    {formatBytes(
                                      tenantUsage.summary.totals.bandwidth.inbound + 
                                      tenantUsage.summary.totals.bandwidth.outbound
                                    )}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="md:col-span-2">
                            <h4 className="font-semibold mb-3">일별 요청 추이</h4>
                            <div className="bg-gray-50 p-4 rounded">
                              <div className="space-y-2">
                                {tenantUsage.dailyStats.map((stat, index) => (
                                  <div key={index} className="flex items-center justify-between text-sm">
                                    <span>{new Date(stat.period.start).toLocaleDateString()}</span>
                                    <div className="flex items-center space-x-4">
                                      <span className="text-green-600">✓ {stat.requests.successful}</span>
                                      <span className="text-red-600">✗ {stat.requests.failed}</span>
                                      <span className="text-yellow-600">⚠ {stat.requests.rateLimited}</span>
                                      <span className="font-medium">총 {stat.requests.total}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}