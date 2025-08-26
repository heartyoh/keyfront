'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { TokenExchangePolicy } from '@/types/token-exchange';

interface TokenExchangeStats {
  totalPolicies: number;
  activePolicies: number;
  exchangesToday: number;
  successRate: number;
  averageExchangeTime: number;
  topAudiences: Array<{ audience: string; count: number }>;
}

export default function TokenExchangeManagement() {
  const [policies, setPolicies] = useState<TokenExchangePolicy[]>([]);
  const [stats, setStats] = useState<TokenExchangeStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPolicy, setSelectedPolicy] = useState<TokenExchangePolicy | null>(null);
  const [activeTab, setActiveTab] = useState<'policies' | 'demo' | 'audit'>('policies');
  const [demoResult, setDemoResult] = useState<any>(null);
  const [demoLoading, setDemoLoading] = useState(false);

  useEffect(() => {
    loadTokenExchangeData();
  }, []);

  const loadTokenExchangeData = async () => {
    try {
      // Load policies
      const policiesResponse = await fetch('/api/token-exchange/policies', {
        credentials: 'include'
      });
      if (policiesResponse.ok) {
        const policiesData = await policiesResponse.json();
        setPolicies(policiesData.data.policies || []);
      }

      // Mock stats - in production, load from actual API
      const mockStats: TokenExchangeStats = {
        totalPolicies: 5,
        activePolicies: 4,
        exchangesToday: 127,
        successRate: 94.8,
        averageExchangeTime: 45,
        topAudiences: [
          { audience: 'api-service', count: 45 },
          { audience: 'data-service', count: 32 },
          { audience: 'notification-service', count: 28 },
        ],
      };
      setStats(mockStats);
    } catch (error) {
      console.error('Failed to load token exchange data:', error);
    } finally {
      setLoading(false);
    }
  };

  const runDemo = async (scenario: string) => {
    setDemoLoading(true);
    try {
      const response = await fetch('/api/token-exchange/demo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ scenario }),
      });

      if (response.ok) {
        const data = await response.json();
        setDemoResult(data.data);
      }
    } catch (error) {
      console.error('Demo failed:', error);
    } finally {
      setDemoLoading(false);
    }
  };

  const getExchangeTypeColor = (type: string) => {
    switch (type) {
      case 'service-to-service': return 'bg-blue-100 text-blue-800';
      case 'delegation': return 'bg-green-100 text-green-800';
      case 'downscoping': return 'bg-yellow-100 text-yellow-800';
      case 'impersonation': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">토큰 교환 데이터 로드 중...</p>
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
                <span className="text-gray-900">토큰 교환 관리</span>
              </div>
              <h1 className="text-2xl font-bold text-gray-900">
                🔄 OAuth 2.0 토큰 교환 (RFC 8693)
              </h1>
              <p className="text-sm text-gray-600">
                서비스 간 안전한 토큰 위임 및 교환 시스템
              </p>
            </div>
            <div className="flex space-x-2">
              <button
                onClick={() => runDemo('service-to-service')}
                className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
              >
                🧪 데모 실행
              </button>
              <button className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
                ➕ 새 정책
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Stats Overview */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-2xl font-bold text-blue-600">{stats.totalPolicies}</div>
              <div className="text-sm text-blue-700">총 정책</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-2xl font-bold text-green-600">{stats.activePolicies}</div>
              <div className="text-sm text-green-700">활성 정책</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-2xl font-bold text-purple-600">{stats.exchangesToday}</div>
              <div className="text-sm text-purple-700">오늘 교환</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-2xl font-bold text-orange-600">{stats.successRate}%</div>
              <div className="text-sm text-orange-700">성공률</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-2xl font-bold text-indigo-600">{stats.averageExchangeTime}ms</div>
              <div className="text-sm text-indigo-700">평균 시간</div>
            </div>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex">
              {[
                { id: 'policies', name: '📋 교환 정책' },
                { id: 'demo', name: '🧪 데모 & 테스트' },
                { id: 'audit', name: '📊 교환 로그' },
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
            {activeTab === 'policies' && (
              <div>
                <h3 className="text-lg font-semibold mb-4">토큰 교환 정책</h3>
                
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    {policies.map((policy) => (
                      <div
                        key={policy.id}
                        className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                          selectedPolicy?.id === policy.id
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                        onClick={() => setSelectedPolicy(policy)}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-medium text-gray-900">{policy.name}</h4>
                          <div className="flex items-center space-x-2">
                            <span className={`px-2 py-1 rounded text-xs ${
                              policy.enabled ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                            }`}>
                              {policy.enabled ? '활성' : '비활성'}
                            </span>
                          </div>
                        </div>
                        
                        <p className="text-sm text-gray-600 mb-2">
                          {policy.metadata.description || '설명이 없습니다.'}
                        </p>
                        
                        <div className="flex items-center justify-between text-xs text-gray-500">
                          <span>대상 서비스: {policy.allowed_subjects.services?.length || 0}개</span>
                          <span>허용 오디언스: {policy.allowed_audiences?.length || 0}개</span>
                        </div>
                        
                        <div className="mt-2 flex items-center justify-between text-xs">
                          <span className="text-gray-500">
                            최대 교환: {policy.exchange_limits.max_exchanges_per_token || '제한 없음'}
                          </span>
                          <span className="text-gray-500">
                            토큰 유효기간: {policy.token_lifetime.default_expires_in}초
                          </span>
                        </div>
                      </div>
                    ))}

                    {policies.length === 0 && (
                      <div className="text-center py-8 text-gray-500">
                        <div className="text-4xl mb-2">🔄</div>
                        <p>생성된 토큰 교환 정책이 없습니다.</p>
                        <button className="mt-2 text-blue-600 hover:text-blue-800 font-medium">
                          첫 번째 정책 생성하기
                        </button>
                      </div>
                    )}
                  </div>

                  <div>
                    {selectedPolicy ? (
                      <div className="border border-gray-200 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-4">
                          <h4 className="font-semibold text-lg">{selectedPolicy.name}</h4>
                          <div className="flex space-x-2">
                            <button className="text-blue-600 hover:text-blue-800 text-sm">편집</button>
                            <button className="text-red-600 hover:text-red-800 text-sm">삭제</button>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <div>
                            <h5 className="font-medium text-gray-700 mb-2">허용된 주체</h5>
                            <div className="bg-gray-50 rounded p-3 text-sm">
                              <div><strong>서비스:</strong> {selectedPolicy.allowed_subjects.services?.join(', ') || '없음'}</div>
                              <div><strong>사용자:</strong> {selectedPolicy.allowed_subjects.users?.join(', ') || '없음'}</div>
                              <div><strong>역할:</strong> {selectedPolicy.allowed_subjects.roles?.join(', ') || '없음'}</div>
                            </div>
                          </div>

                          <div>
                            <h5 className="font-medium text-gray-700 mb-2">스코프 정책</h5>
                            <div className="bg-gray-50 rounded p-3 text-sm">
                              <div><strong>허용 스코프:</strong> {selectedPolicy.scope_policy.allowed_scopes?.join(', ') || '모든 스코프'}</div>
                              <div><strong>다운스코프 전용:</strong> {selectedPolicy.scope_policy.downscope_only ? '예' : '아니오'}</div>
                              <div><strong>주체에서 상속:</strong> {selectedPolicy.scope_policy.inherit_from_subject ? '예' : '아니오'}</div>
                            </div>
                          </div>

                          <div>
                            <h5 className="font-medium text-gray-700 mb-2">교환 제한</h5>
                            <div className="bg-gray-50 rounded p-3 text-sm">
                              <div><strong>최대 교환 횟수:</strong> {selectedPolicy.exchange_limits.max_exchanges_per_token || '제한 없음'}</div>
                              <div><strong>최대 위임 깊이:</strong> {selectedPolicy.exchange_limits.max_delegation_depth}</div>
                            </div>
                          </div>

                          <div>
                            <h5 className="font-medium text-gray-700 mb-2">토큰 수명</h5>
                            <div className="bg-gray-50 rounded p-3 text-sm">
                              <div><strong>기본 만료시간:</strong> {selectedPolicy.token_lifetime.default_expires_in}초</div>
                              <div><strong>최대 만료시간:</strong> {selectedPolicy.token_lifetime.max_expires_in || '제한 없음'}초</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="border border-gray-200 rounded-lg p-8 text-center text-gray-500">
                        <div className="text-4xl mb-2">👈</div>
                        <p>정책을 선택하여 상세 정보를 확인하세요</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'demo' && (
              <div>
                <h3 className="text-lg font-semibold mb-4">토큰 교환 데모</h3>
                
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <h4 className="font-medium">시나리오 선택</h4>
                    
                    <div className="space-y-3">
                      {[
                        {
                          id: 'service-to-service',
                          title: '서비스 간 토큰 교환',
                          description: '마이크로서비스 간 API 호출을 위한 토큰 교환',
                          icon: '🔄',
                        },
                        {
                          id: 'downscoping',
                          title: '스코프 다운그레이드',
                          description: '제한된 권한을 가진 토큰으로 교환',
                          icon: '⬇️',
                        },
                        {
                          id: 'delegation',
                          title: '사용자 위임',
                          description: '사용자를 대신하여 서비스가 작업 수행',
                          icon: '🎭',
                        },
                      ].map((scenario) => (
                        <div
                          key={scenario.id}
                          className="border border-gray-200 rounded-lg p-4 hover:border-blue-300 cursor-pointer"
                          onClick={() => runDemo(scenario.id)}
                        >
                          <div className="flex items-center space-x-3">
                            <div className="text-2xl">{scenario.icon}</div>
                            <div>
                              <h5 className="font-medium">{scenario.title}</h5>
                              <p className="text-sm text-gray-600">{scenario.description}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h4 className="font-medium mb-4">실행 결과</h4>
                    
                    {demoLoading ? (
                      <div className="border border-gray-200 rounded-lg p-8 text-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
                        <p className="text-gray-600">데모 실행 중...</p>
                      </div>
                    ) : demoResult ? (
                      <div className="border border-gray-200 rounded-lg p-4 space-y-4">
                        <div className="flex items-center justify-between">
                          <h5 className="font-medium">시나리오: {demoResult.scenario}</h5>
                          <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-sm">성공</span>
                        </div>
                        
                        {demoResult.demo.original_token && (
                          <div>
                            <h6 className="font-medium text-sm text-gray-700">원본 토큰</h6>
                            <div className="bg-gray-50 rounded p-3 text-xs font-mono">
                              <div>주체: {demoResult.demo.original_token.sub}</div>
                              <div>오디언스: {demoResult.demo.original_token.aud}</div>
                              <div>스코프: {demoResult.demo.original_token.scope}</div>
                            </div>
                          </div>
                        )}
                        
                        {demoResult.demo.exchanged_token && (
                          <div>
                            <h6 className="font-medium text-sm text-gray-700">교환된 토큰</h6>
                            <div className="bg-blue-50 rounded p-3 text-xs font-mono">
                              <div>주체: {demoResult.demo.exchanged_token.sub}</div>
                              <div>오디언스: {demoResult.demo.exchanged_token.aud}</div>
                              <div>스코프: {demoResult.demo.exchanged_token.scope}</div>
                              <div>교환 횟수: {demoResult.demo.exchanged_token.exchange_count}</div>
                            </div>
                          </div>
                        )}
                        
                        {demoResult.demo.scope_comparison && (
                          <div>
                            <h6 className="font-medium text-sm text-gray-700">스코프 비교</h6>
                            <div className="bg-gray-50 rounded p-3 text-xs">
                              <div className="text-red-600">제거된 스코프: {demoResult.demo.scope_comparison.removed_scopes.join(', ')}</div>
                              <div className="text-green-600">유지된 스코프: {demoResult.demo.scope_comparison.granted_scopes.join(', ')}</div>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="border border-gray-200 rounded-lg p-8 text-center text-gray-500">
                        <div className="text-4xl mb-2">🧪</div>
                        <p>시나리오를 선택하여 데모를 실행하세요</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'audit' && (
              <div>
                <h3 className="text-lg font-semibold mb-4">토큰 교환 감사 로그</h3>
                
                {stats && (
                  <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
                    <h4 className="font-medium mb-3">인기 있는 오디언스</h4>
                    <div className="space-y-2">
                      {stats.topAudiences.map((item, index) => (
                        <div key={index} className="flex items-center justify-between">
                          <span className="text-sm font-mono">{item.audience}</span>
                          <div className="flex items-center space-x-2">
                            <div className="w-32 bg-gray-200 rounded-full h-2">
                              <div 
                                className="bg-blue-500 h-2 rounded-full" 
                                style={{ width: `${(item.count / Math.max(...stats.topAudiences.map(i => i.count))) * 100}%` }}
                              ></div>
                            </div>
                            <span className="text-sm font-semibold text-blue-600">{item.count}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                <div className="text-center py-8 text-gray-500">
                  <div className="text-4xl mb-2">📋</div>
                  <p>상세한 토큰 교환 로그는 감사 대시보드에서 확인할 수 있습니다</p>
                  <Link href="/audit-dashboard" className="mt-2 inline-block text-blue-600 hover:text-blue-800 font-medium">
                    감사 대시보드로 이동 →
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}