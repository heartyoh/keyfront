'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Policy, PolicyRule } from '@/types/abac';

interface AbacStats {
  totalPolicies: number;
  activePolicies: number;
  totalRules: number;
  evaluationsToday: number;
  averageEvaluationTime: number;
  topDeniedActions: Array<{ action: string; count: number }>;
}

export default function AbacManagement() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [stats, setStats] = useState<AbacStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPolicy, setSelectedPolicy] = useState<Policy | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'policies' | 'evaluation' | 'audit'>('policies');

  useEffect(() => {
    loadAbacData();
  }, []);

  const loadAbacData = async () => {
    try {
      // Load policies
      const policiesResponse = await fetch('/api/abac/policies', {
        credentials: 'include'
      });
      if (policiesResponse.ok) {
        const policiesData = await policiesResponse.json();
        setPolicies(policiesData.data.policies || []);
      }

      // Mock stats - in production, load from actual API
      const mockStats: AbacStats = {
        totalPolicies: 12,
        activePolicies: 10,
        totalRules: 47,
        evaluationsToday: 2847,
        averageEvaluationTime: 23,
        topDeniedActions: [
          { action: 'admin:delete', count: 23 },
          { action: 'write:sensitive_data', count: 18 },
          { action: 'read:confidential', count: 12 },
        ],
      };
      setStats(mockStats);
    } catch (error) {
      console.error('Failed to load ABAC data:', error);
    } finally {
      setLoading(false);
    }
  };

  const togglePolicyStatus = async (policyId: string, enabled: boolean) => {
    try {
      const response = await fetch(`/api/abac/policies/${policyId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ enabled }),
      });

      if (response.ok) {
        await loadAbacData();
      }
    } catch (error) {
      console.error('Failed to toggle policy status:', error);
    }
  };

  const getSeverityColor = (priority: number) => {
    if (priority >= 200) return 'bg-red-100 text-red-800';
    if (priority >= 150) return 'bg-orange-100 text-orange-800';
    if (priority >= 100) return 'bg-yellow-100 text-yellow-800';
    return 'bg-green-100 text-green-800';
  };

  const getPriorityLabel = (priority: number) => {
    if (priority >= 200) return '높음';
    if (priority >= 150) return '보통';
    if (priority >= 100) return '낮음';
    return '최소';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">ABAC 데이터 로드 중...</p>
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
                <span className="text-gray-900">ABAC 정책 관리</span>
              </div>
              <h1 className="text-2xl font-bold text-gray-900">
                🛡️ 속성 기반 접근 제어 (ABAC)
              </h1>
              <p className="text-sm text-gray-600">
                정책 기반 동적 권한 관리 시스템
              </p>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            >
              ➕ 새 정책 생성
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Stats Overview */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-2xl font-bold text-blue-600">{stats.totalPolicies}</div>
              <div className="text-sm text-blue-700">총 정책</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-2xl font-bold text-green-600">{stats.activePolicies}</div>
              <div className="text-sm text-green-700">활성 정책</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-2xl font-bold text-purple-600">{stats.totalRules}</div>
              <div className="text-sm text-purple-700">총 규칙</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-2xl font-bold text-orange-600">{stats.evaluationsToday}</div>
              <div className="text-sm text-orange-700">오늘 평가</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-2xl font-bold text-indigo-600">{stats.averageEvaluationTime}ms</div>
              <div className="text-sm text-indigo-700">평균 시간</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-2xl font-bold text-red-600">
                {stats.topDeniedActions.reduce((sum, item) => sum + item.count, 0)}
              </div>
              <div className="text-sm text-red-700">거부된 요청</div>
            </div>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex">
              {[
                { id: 'policies', name: '📋 정책 관리' },
                { id: 'evaluation', name: '⚖️ 평가 테스트' },
                { id: 'audit', name: '📊 감사 로그' },
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
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold">정책 목록</h3>
                  <div className="flex space-x-2">
                    <select className="border border-gray-300 rounded px-3 py-1 text-sm">
                      <option value="">모든 상태</option>
                      <option value="active">활성</option>
                      <option value="inactive">비활성</option>
                    </select>
                    <input
                      type="text"
                      placeholder="정책 검색..."
                      className="border border-gray-300 rounded px-3 py-1 text-sm"
                    />
                  </div>
                </div>

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
                          <div className="flex items-center space-x-2">
                            <h4 className="font-medium text-gray-900">{policy.name}</h4>
                            <span className={`px-2 py-1 rounded text-xs ${getSeverityColor(Math.max(...policy.rules.map(r => r.priority)))}`}>
                              우선순위: {getPriorityLabel(Math.max(...policy.rules.map(r => r.priority)))}
                            </span>
                          </div>
                          <label className="flex items-center">
                            <input
                              type="checkbox"
                              checked={policy.enabled}
                              onChange={(e) => togglePolicyStatus(policy.id, e.target.checked)}
                              className="rounded"
                            />
                            <span className="ml-2 text-sm text-gray-600">활성</span>
                          </label>
                        </div>
                        
                        <p className="text-sm text-gray-600 mb-2">
                          {policy.description || '설명이 없습니다.'}
                        </p>
                        
                        <div className="flex items-center justify-between text-xs text-gray-500">
                          <span>규칙: {policy.rules.length}개</span>
                          <span>버전: {policy.version}</span>
                          <span>생성: {new Date(policy.metadata.createdAt).toLocaleDateString()}</span>
                        </div>
                        
                        {policy.metadata.tags.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {policy.metadata.tags.map((tag, index) => (
                              <span key={index} className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}

                    {policies.length === 0 && (
                      <div className="text-center py-8 text-gray-500">
                        <div className="text-4xl mb-2">📝</div>
                        <p>생성된 정책이 없습니다.</p>
                        <button
                          onClick={() => setShowCreateModal(true)}
                          className="mt-2 text-blue-600 hover:text-blue-800 font-medium"
                        >
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
                            <h5 className="font-medium text-gray-700 mb-2">정책 정보</h5>
                            <div className="grid grid-cols-2 gap-2 text-sm">
                              <div><strong>버전:</strong> {selectedPolicy.version}</div>
                              <div><strong>상태:</strong> 
                                <span className={`ml-1 ${selectedPolicy.enabled ? 'text-green-600' : 'text-red-600'}`}>
                                  {selectedPolicy.enabled ? '활성' : '비활성'}
                                </span>
                              </div>
                              <div><strong>생성자:</strong> {selectedPolicy.metadata.createdBy}</div>
                              <div><strong>수정일:</strong> {new Date(selectedPolicy.metadata.updatedAt).toLocaleDateString()}</div>
                            </div>
                          </div>

                          <div>
                            <h5 className="font-medium text-gray-700 mb-2">규칙 목록 ({selectedPolicy.rules.length}개)</h5>
                            <div className="space-y-2 max-h-64 overflow-y-auto">
                              {selectedPolicy.rules.map((rule, index) => (
                                <div key={rule.id} className="border border-gray-100 rounded p-3">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="font-medium text-sm">{rule.name}</span>
                                    <div className="flex items-center space-x-2">
                                      <span className={`px-2 py-1 rounded text-xs ${
                                        rule.effect === 'permit' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                      }`}>
                                        {rule.effect === 'permit' ? '허용' : '거부'}
                                      </span>
                                      <span className="text-xs text-gray-500">우선순위: {rule.priority}</span>
                                    </div>
                                  </div>
                                  <p className="text-xs text-gray-600">{rule.description || '설명 없음'}</p>
                                  
                                  {rule.condition && rule.condition.length > 0 && (
                                    <div className="mt-2">
                                      <div className="text-xs text-gray-500">조건: {rule.condition.length}개</div>
                                      {rule.condition.slice(0, 2).map((cond, i) => (
                                        <div key={i} className="text-xs text-gray-400 ml-2">
                                          • {cond.attribute} {cond.operator} {JSON.stringify(cond.value)}
                                        </div>
                                      ))}
                                      {rule.condition.length > 2 && (
                                        <div className="text-xs text-gray-400 ml-2">
                                          ...및 {rule.condition.length - 2}개 더
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              ))}
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

            {activeTab === 'evaluation' && (
              <div>
                <h3 className="text-lg font-semibold mb-4">ABAC 정책 평가 테스트</h3>
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                  <div className="flex items-center space-x-2">
                    <span className="text-yellow-600">⚠️</span>
                    <div>
                      <h4 className="font-medium text-yellow-800">테스트 환경</h4>
                      <p className="text-sm text-yellow-700">
                        실제 데이터에 영향을 주지 않는 시뮬레이션 환경입니다.
                      </p>
                    </div>
                  </div>
                </div>
                
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="bg-gray-50 rounded-lg p-4">
                    <h4 className="font-medium mb-4">접근 요청 시뮬레이션</h4>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">리소스 타입</label>
                        <select className="w-full border border-gray-300 rounded px-3 py-2">
                          <option value="document">문서</option>
                          <option value="api_endpoint">API 엔드포인트</option>
                          <option value="tenant">테넌트</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">액션</label>
                        <select className="w-full border border-gray-300 rounded px-3 py-2">
                          <option value="read">읽기</option>
                          <option value="write">쓰기</option>
                          <option value="delete">삭제</option>
                          <option value="admin">관리자</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">사용자 역할</label>
                        <select className="w-full border border-gray-300 rounded px-3 py-2">
                          <option value="user">일반 사용자</option>
                          <option value="admin">관리자</option>
                          <option value="auditor">감사관</option>
                        </select>
                      </div>
                      <button className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700">
                        평가 실행
                      </button>
                    </div>
                  </div>
                  
                  <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <h4 className="font-medium mb-4">평가 결과</h4>
                    <div className="text-center text-gray-500 py-8">
                      <div className="text-4xl mb-2">🎯</div>
                      <p>평가를 실행하여 결과를 확인하세요</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'audit' && (
              <div>
                <h3 className="text-lg font-semibold mb-4">ABAC 평가 감사 로그</h3>
                
                {stats && (
                  <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
                    <h4 className="font-medium mb-3">자주 거부되는 액션</h4>
                    <div className="space-y-2">
                      {stats.topDeniedActions.map((item, index) => (
                        <div key={index} className="flex items-center justify-between">
                          <span className="text-sm font-mono">{item.action}</span>
                          <div className="flex items-center space-x-2">
                            <div className="w-32 bg-gray-200 rounded-full h-2">
                              <div 
                                className="bg-red-500 h-2 rounded-full" 
                                style={{ width: `${(item.count / Math.max(...stats.topDeniedActions.map(i => i.count))) * 100}%` }}
                              ></div>
                            </div>
                            <span className="text-sm font-semibold text-red-600">{item.count}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                <div className="text-center py-8 text-gray-500">
                  <div className="text-4xl mb-2">📈</div>
                  <p>상세한 감사 로그는 감사 대시보드에서 확인할 수 있습니다</p>
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