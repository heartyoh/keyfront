'use client';

import { useState } from 'react';

export default function CorsTestPage() {
  const [testResults, setTestResults] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const addResult = (result: string) => {
    setTestResults(prev => [...prev, `${new Date().toLocaleTimeString()}: ${result}`]);
  };

  const testCorsRequest = async (origin: string, withCredentials = false) => {
    try {
      setLoading(true);
      addResult(`🔄 Testing CORS from origin: ${origin}`);

      const response = await fetch('/api/me', {
        method: 'GET',
        headers: {
          'Origin': origin
        },
        credentials: withCredentials ? 'include' : 'omit'
      });

      if (response.ok) {
        addResult(`✅ CORS allowed for ${origin} - Status: ${response.status}`);
        const corsHeaders = {
          'Access-Control-Allow-Origin': response.headers.get('Access-Control-Allow-Origin'),
          'Access-Control-Allow-Credentials': response.headers.get('Access-Control-Allow-Credentials'),
        };
        addResult(`📋 CORS Headers: ${JSON.stringify(corsHeaders, null, 2)}`);
      } else {
        addResult(`❌ CORS blocked for ${origin} - Status: ${response.status}`);
      }
    } catch (error) {
      addResult(`🚨 Error testing ${origin}: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const testPreflightRequest = async (origin: string) => {
    try {
      setLoading(true);
      addResult(`🔄 Testing CORS preflight for: ${origin}`);

      const response = await fetch('/api/me', {
        method: 'OPTIONS',
        headers: {
          'Origin': origin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, Authorization'
        }
      });

      if (response.status === 204 || response.status === 200) {
        addResult(`✅ Preflight allowed for ${origin} - Status: ${response.status}`);
        const preflightHeaders = {
          'Access-Control-Allow-Origin': response.headers.get('Access-Control-Allow-Origin'),
          'Access-Control-Allow-Methods': response.headers.get('Access-Control-Allow-Methods'),
          'Access-Control-Allow-Headers': response.headers.get('Access-Control-Allow-Headers'),
          'Access-Control-Max-Age': response.headers.get('Access-Control-Max-Age'),
        };
        addResult(`📋 Preflight Headers: ${JSON.stringify(preflightHeaders, null, 2)}`);
      } else {
        addResult(`❌ Preflight blocked for ${origin} - Status: ${response.status}`);
      }
    } catch (error) {
      addResult(`🚨 Preflight error for ${origin}: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const clearResults = () => {
    setTestResults([]);
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">
          🛡️ CORS 정책 테스트
        </h1>

        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">CORS 테스트 시나리오</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            {/* 허용된 Origin 테스트 */}
            <div className="space-y-2">
              <h3 className="font-semibold text-green-700">✅ 허용된 Origin</h3>
              <button
                onClick={() => testCorsRequest('http://localhost:3000', true)}
                disabled={loading}
                className="w-full bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50"
              >
                localhost:3000 (with credentials)
              </button>
              <button
                onClick={() => testCorsRequest('http://localhost:3001')}
                disabled={loading}
                className="w-full bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50"
              >
                localhost:3001
              </button>
              <button
                onClick={() => testPreflightRequest('http://localhost:3000')}
                disabled={loading}
                className="w-full bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
              >
                Preflight Test (3000)
              </button>
            </div>

            {/* 차단된 Origin 테스트 */}
            <div className="space-y-2">
              <h3 className="font-semibold text-red-700">❌ 차단된 Origin</h3>
              <button
                onClick={() => testCorsRequest('http://evil-site.com')}
                disabled={loading}
                className="w-full bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 disabled:opacity-50"
              >
                evil-site.com
              </button>
              <button
                onClick={() => testCorsRequest('http://localhost:9999')}
                disabled={loading}
                className="w-full bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 disabled:opacity-50"
              >
                localhost:9999 (불허)
              </button>
              <button
                onClick={() => testPreflightRequest('http://malicious.example.com')}
                disabled={loading}
                className="w-full bg-orange-600 text-white px-4 py-2 rounded hover:bg-orange-700 disabled:opacity-50"
              >
                Malicious Preflight
              </button>
            </div>
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
                <span className="text-sm text-gray-600">테스트 중...</span>
              </div>
            )}
          </div>
        </div>

        {/* 테스트 결과 */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">📊 테스트 결과</h2>
          <div className="bg-gray-900 text-green-400 p-4 rounded font-mono text-sm max-h-96 overflow-y-auto">
            {testResults.length === 0 ? (
              <div className="text-gray-500">위의 버튼을 클릭하여 CORS 테스트를 시작하세요...</div>
            ) : (
              testResults.map((result, index) => (
                <div key={index} className="mb-1">
                  {result}
                </div>
              ))
            )}
          </div>
        </div>

        {/* 현재 CORS 설정 정보 */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mt-6">
          <h3 className="text-lg font-semibold text-blue-800 mb-2">ℹ️ 현재 CORS 설정</h3>
          <ul className="text-blue-700 space-y-1">
            <li>• 허용된 Origins: localhost:3000, localhost:3001, localhost:3002</li>
            <li>• Credentials 허용: 예</li>
            <li>• Max Age: 24시간</li>
            <li>• 개발 모드: localhost 자동 허용</li>
            <li>• 테넌트별 Origin 지원</li>
          </ul>
        </div>
      </div>
    </div>
  );
}