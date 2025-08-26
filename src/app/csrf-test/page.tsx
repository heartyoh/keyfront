'use client';

import { useState, useEffect } from 'react';

interface CsrfTokenInfo {
  token: string;
  expiresAt: number;
}

interface CsrfStats {
  session: {
    sessionId: string;
    totalTokens: number;
    expiredTokens: number;
    validTokens: number;
    cleanedUpTokens: number;
  };
  global?: {
    totalTokens: number;
    expiredTokens: number;
    validTokens: number;
  };
  timestamp: string;
}

export default function CsrfTestPage() {
  const [csrfToken, setCsrfToken] = useState<string>('');
  const [tokenInfo, setTokenInfo] = useState<CsrfTokenInfo | null>(null);
  const [testResults, setTestResults] = useState<string[]>([]);
  const [stats, setStats] = useState<CsrfStats | null>(null);
  const [loading, setLoading] = useState(false);

  const addResult = (result: string) => {
    setTestResults(prev => [...prev, `${new Date().toLocaleTimeString()}: ${result}`]);
  };

  // Get new CSRF token
  const getCsrfToken = async () => {
    try {
      setLoading(true);
      addResult('🔄 CSRF 토큰 요청 중...');
      
      const response = await fetch('/api/csrf', {
        method: 'GET',
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setCsrfToken(data.data.token);
          setTokenInfo(data.data);
          addResult(`✅ 새 CSRF 토큰 생성: ${data.data.token.substring(0, 16)}...`);
          addResult(`⏰ 만료시간: ${new Date(data.data.expiresAt).toLocaleString()}`);
        } else {
          addResult(`❌ 토큰 생성 실패: ${data.error.message}`);
        }
      } else {
        addResult(`❌ HTTP ${response.status}: CSRF 토큰 요청 실패`);
      }
    } catch (error) {
      addResult(`🚨 네트워크 오류: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  // Validate current token
  const validateToken = async () => {
    if (!csrfToken) {
      addResult('⚠️  검증할 토큰이 없습니다. 먼저 토큰을 생성하세요.');
      return;
    }

    try {
      setLoading(true);
      addResult('🔍 CSRF 토큰 검증 중...');

      const response = await fetch('/api/csrf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({ token: csrfToken }),
        credentials: 'include'
      });

      const data = await response.json();
      if (response.ok && data.success) {
        addResult(`✅ 토큰 검증 성공: ${data.message}`);
      } else {
        addResult(`❌ 토큰 검증 실패: ${data.error?.message || 'Unknown error'}`);
      }
    } catch (error) {
      addResult(`🚨 검증 오류: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  // Test CSRF protection by sending request without token
  const testWithoutToken = async () => {
    try {
      setLoading(true);
      addResult('🧪 CSRF 토큰 없이 요청 테스트...');

      const response = await fetch('/api/csrf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ test: 'data' }),
        credentials: 'include'
      });

      const data = await response.json();
      if (response.status === 403) {
        addResult(`✅ CSRF 보호 동작: ${data.error.message}`);
      } else {
        addResult(`❌ CSRF 보호 실패: 토큰 없이 요청 성공`);
      }
    } catch (error) {
      addResult(`🚨 테스트 오류: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  // Test with invalid token
  const testWithInvalidToken = async () => {
    try {
      setLoading(true);
      addResult('🧪 잘못된 CSRF 토큰으로 테스트...');

      const fakeToken = 'invalid-token-' + Math.random().toString(36).substring(7);

      const response = await fetch('/api/csrf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': fakeToken,
        },
        body: JSON.stringify({ token: fakeToken }),
        credentials: 'include'
      });

      const data = await response.json();
      if (response.status === 403) {
        addResult(`✅ 잘못된 토큰 차단: ${data.error.message}`);
      } else {
        addResult(`❌ 보안 실패: 잘못된 토큰 통과`);
      }
    } catch (error) {
      addResult(`🚨 테스트 오류: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  // Get CSRF statistics
  const getStats = async () => {
    try {
      setLoading(true);
      addResult('📊 CSRF 통계 조회 중...');

      const response = await fetch('/api/csrf/stats', {
        method: 'GET',
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setStats(data.data);
          addResult('✅ 통계 조회 성공');
        } else {
          addResult(`❌ 통계 조회 실패: ${data.error.message}`);
        }
      } else {
        addResult(`❌ HTTP ${response.status}: 통계 조회 실패`);
      }
    } catch (error) {
      addResult(`🚨 통계 조회 오류: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  // Invalidate all tokens
  const invalidateTokens = async () => {
    try {
      setLoading(true);
      addResult('🗑️  모든 CSRF 토큰 무효화...');

      const response = await fetch('/api/csrf', {
        method: 'DELETE',
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          addResult(`✅ ${data.data.invalidatedTokens}개 토큰 무효화 완료`);
          setCsrfToken('');
          setTokenInfo(null);
        } else {
          addResult(`❌ 토큰 무효화 실패: ${data.error.message}`);
        }
      } else {
        addResult(`❌ HTTP ${response.status}: 토큰 무효화 실패`);
      }
    } catch (error) {
      addResult(`🚨 무효화 오류: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const clearResults = () => {
    setTestResults([]);
  };

  // Auto-load token on mount
  useEffect(() => {
    getCsrfToken();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">
          🛡️ CSRF 보호 테스트
        </h1>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* 현재 토큰 정보 */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">🎫 현재 CSRF 토큰</h2>
            {tokenInfo ? (
              <div className="space-y-2">
                <div className="bg-gray-100 p-3 rounded font-mono text-sm break-all">
                  {tokenInfo.token}
                </div>
                <p className="text-sm text-gray-600">
                  만료: {new Date(tokenInfo.expiresAt).toLocaleString()}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={getCsrfToken}
                    disabled={loading}
                    className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
                  >
                    새 토큰
                  </button>
                  <button
                    onClick={validateToken}
                    disabled={loading}
                    className="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700 disabled:opacity-50"
                  >
                    토큰 검증
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-gray-500">
                <p>토큰이 없습니다.</p>
                <button
                  onClick={getCsrfToken}
                  disabled={loading}
                  className="mt-2 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  토큰 생성
                </button>
              </div>
            )}
          </div>

          {/* 통계 정보 */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">📊 CSRF 통계</h2>
            {stats ? (
              <div className="space-y-3">
                <div className="bg-blue-50 p-3 rounded">
                  <h3 className="font-semibold text-blue-800">세션 통계</h3>
                  <ul className="text-sm text-blue-700 mt-1">
                    <li>전체 토큰: {stats.session.totalTokens}</li>
                    <li>유효한 토큰: {stats.session.validTokens}</li>
                    <li>만료된 토큰: {stats.session.expiredTokens}</li>
                    <li>정리된 토큰: {stats.session.cleanedUpTokens}</li>
                  </ul>
                </div>
                <button
                  onClick={getStats}
                  disabled={loading}
                  className="bg-purple-600 text-white px-4 py-2 rounded text-sm hover:bg-purple-700 disabled:opacity-50"
                >
                  통계 새로고침
                </button>
              </div>
            ) : (
              <div className="text-gray-500">
                <button
                  onClick={getStats}
                  disabled={loading}
                  className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700 disabled:opacity-50"
                >
                  통계 조회
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 보안 테스트 */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">🧪 보안 테스트</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <button
              onClick={testWithoutToken}
              disabled={loading}
              className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 disabled:opacity-50"
            >
              토큰 없이 요청
            </button>
            <button
              onClick={testWithInvalidToken}
              disabled={loading}
              className="bg-orange-600 text-white px-4 py-2 rounded hover:bg-orange-700 disabled:opacity-50"
            >
              잘못된 토큰으로 요청
            </button>
            <button
              onClick={invalidateTokens}
              disabled={loading}
              className="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700 disabled:opacity-50"
            >
              모든 토큰 무효화
            </button>
          </div>
          
          <div className="flex justify-between items-center">
            <button
              onClick={clearResults}
              className="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600"
            >
              결과 지우기
            </button>
            {loading && (
              <div className="flex items-center">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
                <span className="text-sm text-gray-600">처리 중...</span>
              </div>
            )}
          </div>
        </div>

        {/* 테스트 결과 */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">📋 테스트 결과</h2>
          <div className="bg-gray-900 text-green-400 p-4 rounded font-mono text-sm max-h-96 overflow-y-auto">
            {testResults.length === 0 ? (
              <div className="text-gray-500">위의 버튼을 클릭하여 CSRF 테스트를 시작하세요...</div>
            ) : (
              testResults.map((result, index) => (
                <div key={index} className="mb-1">
                  {result}
                </div>
              ))
            )}
          </div>
        </div>

        {/* CSRF 보호 설명 */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mt-6">
          <h3 className="text-lg font-semibold text-blue-800 mb-4">ℹ️ CSRF 보호 메커니즘</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-blue-700">
            <div>
              <h4 className="font-semibold mb-2">더블 서브밋 쿠키 패턴</h4>
              <ul className="space-y-1 text-sm">
                <li>• 토큰을 쿠키와 헤더에 모두 전송</li>
                <li>• 서버에서 두 값이 일치하는지 확인</li>
                <li>• SameSite 쿠키로 추가 보호</li>
                <li>• HMAC 기반 토큰 검증</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-2">보안 기능</h4>
              <ul className="space-y-1 text-sm">
                <li>• 세션별 토큰 격리</li>
                <li>• 시간 기반 만료</li>
                <li>• Redis 기반 토큰 저장</li>
                <li>• 자동 토큰 정리</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}