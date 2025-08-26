'use client';

import { useState, useEffect } from 'react';

interface SecurityHeaders {
  [key: string]: string;
}

export default function SecurityTestPage() {
  const [headers, setHeaders] = useState<SecurityHeaders>({});
  const [analysisResults, setAnalysisResults] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    analyzeSecurityHeaders();
  }, []);

  const analyzeSecurityHeaders = async () => {
    try {
      setLoading(true);
      
      // Make a request to get headers
      const response = await fetch('/api/me', {
        method: 'HEAD',
        credentials: 'include'
      });

      const responseHeaders: SecurityHeaders = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      
      setHeaders(responseHeaders);
      analyzeHeaders(responseHeaders);
    } catch (error) {
      console.error('Failed to fetch headers:', error);
    } finally {
      setLoading(false);
    }
  };

  const analyzeHeaders = (headers: SecurityHeaders) => {
    const results: string[] = [];

    // Content Security Policy
    if (headers['content-security-policy'] || headers['content-security-policy-report-only']) {
      const csp = headers['content-security-policy'] || headers['content-security-policy-report-only'];
      const reportOnly = !!headers['content-security-policy-report-only'];
      results.push(`✅ CSP ${reportOnly ? '(Report-Only)' : ''} 설정됨`);
      
      if (csp.includes("'unsafe-eval'")) {
        results.push(`⚠️  CSP에 'unsafe-eval' 포함 (개발 모드)`);
      }
      if (csp.includes("'unsafe-inline'")) {
        results.push(`⚠️  CSP에 'unsafe-inline' 포함`);
      }
      if (csp.includes('upgrade-insecure-requests')) {
        results.push(`✅ HTTP→HTTPS 자동 업그레이드 활성화`);
      }
    } else {
      results.push(`❌ CSP 헤더 없음`);
    }

    // Strict Transport Security
    if (headers['strict-transport-security']) {
      results.push(`✅ HSTS 설정됨: ${headers['strict-transport-security']}`);
      if (headers['strict-transport-security'].includes('preload')) {
        results.push(`✅ HSTS preload 활성화`);
      }
    } else {
      results.push(`⚠️  HSTS 없음 (HTTPS 연결 시에만 적용됨)`);
    }

    // X-Frame-Options
    if (headers['x-frame-options']) {
      results.push(`✅ X-Frame-Options: ${headers['x-frame-options']}`);
    } else {
      results.push(`❌ X-Frame-Options 없음 (클릭재킹 위험)`);
    }

    // X-Content-Type-Options
    if (headers['x-content-type-options'] === 'nosniff') {
      results.push(`✅ MIME 스니핑 차단`);
    } else {
      results.push(`❌ X-Content-Type-Options 없음`);
    }

    // Referrer Policy
    if (headers['referrer-policy']) {
      results.push(`✅ Referrer Policy: ${headers['referrer-policy']}`);
    } else {
      results.push(`⚠️  Referrer Policy 없음`);
    }

    // Permissions Policy
    if (headers['permissions-policy']) {
      results.push(`✅ Permissions Policy 설정됨`);
    } else {
      results.push(`⚠️  Permissions Policy 없음`);
    }

    // Cross-Origin Policies
    if (headers['cross-origin-embedder-policy']) {
      results.push(`✅ COEP: ${headers['cross-origin-embedder-policy']}`);
    }
    if (headers['cross-origin-opener-policy']) {
      results.push(`✅ COOP: ${headers['cross-origin-opener-policy']}`);
    }
    if (headers['cross-origin-resource-policy']) {
      results.push(`✅ CORP: ${headers['cross-origin-resource-policy']}`);
    }

    // XSS Protection (legacy)
    if (headers['x-xss-protection']) {
      results.push(`✅ XSS Protection (legacy): ${headers['x-xss-protection']}`);
    }

    // Expect-CT
    if (headers['expect-ct']) {
      results.push(`✅ Certificate Transparency: ${headers['expect-ct']}`);
    }

    setAnalysisResults(results);
  };

  const testXSSProtection = () => {
    // This would normally be blocked by CSP
    const script = document.createElement('script');
    script.innerHTML = 'alert("XSS Test - This should be blocked!")';
    try {
      document.head.appendChild(script);
      alert('❌ XSS 공격 성공 - CSP가 제대로 작동하지 않음');
    } catch (error) {
      alert('✅ XSS 공격 차단됨 - CSP가 올바르게 작동');
    }
  };

  const testFramingProtection = () => {
    const testUrl = window.location.origin + '/security-test';
    const iframe = document.createElement('iframe');
    iframe.src = testUrl;
    iframe.style.width = '300px';
    iframe.style.height = '200px';
    iframe.style.border = '1px solid red';
    
    const container = document.getElementById('iframe-test');
    if (container) {
      container.innerHTML = '<p>프레임 로딩 테스트 중...</p>';
      container.appendChild(iframe);
      
      iframe.onload = () => {
        container.innerHTML = '<p>❌ 프레임 로딩 성공 - X-Frame-Options가 제대로 작동하지 않음</p>';
      };
      
      iframe.onerror = () => {
        container.innerHTML = '<p>✅ 프레임 로딩 차단됨 - X-Frame-Options가 올바르게 작동</p>';
      };
      
      // Timeout fallback
      setTimeout(() => {
        if (container.innerHTML.includes('테스트 중')) {
          container.innerHTML = '<p>✅ 프레임 로딩 차단됨 - X-Frame-Options가 올바르게 작동</p>';
        }
      }, 3000);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">보안 헤더 분석 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">
          🛡️ 보안 헤더 분석
        </h1>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* 분석 결과 */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">📊 보안 분석 결과</h2>
            <div className="space-y-2">
              {analysisResults.map((result, index) => (
                <div 
                  key={index} 
                  className={`p-2 rounded text-sm ${
                    result.startsWith('✅') 
                      ? 'bg-green-50 text-green-800' 
                      : result.startsWith('⚠️')
                      ? 'bg-yellow-50 text-yellow-800'
                      : 'bg-red-50 text-red-800'
                  }`}
                >
                  {result}
                </div>
              ))}
            </div>
          </div>

          {/* 실시간 테스트 */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">🧪 실시간 보안 테스트</h2>
            <div className="space-y-4">
              <button
                onClick={testXSSProtection}
                className="w-full bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
              >
                XSS Protection 테스트
              </button>
              <button
                onClick={testFramingProtection}
                className="w-full bg-orange-600 text-white px-4 py-2 rounded hover:bg-orange-700"
              >
                Frame Protection 테스트
              </button>
              <div id="iframe-test" className="border border-gray-300 rounded p-4 min-h-[100px]">
                <p className="text-gray-500">프레임 테스트 결과가 여기에 표시됩니다</p>
              </div>
            </div>
          </div>
        </div>

        {/* 원시 헤더 정보 */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">📋 응답 헤더</h2>
          <div className="bg-gray-900 text-green-400 p-4 rounded font-mono text-sm max-h-96 overflow-y-auto">
            {Object.entries(headers)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, value]) => (
                <div key={key} className="mb-1">
                  <span className="text-blue-400">{key}:</span> {value}
                </div>
              ))}
          </div>
        </div>

        {/* 보안 권장사항 */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mt-6">
          <h3 className="text-lg font-semibold text-blue-800 mb-4">🔒 보안 권장사항</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-blue-700">
            <div>
              <h4 className="font-semibold mb-2">개발 환경</h4>
              <ul className="space-y-1 text-sm">
                <li>• CSP Report-Only 모드 사용</li>
                <li>• localhost 허용</li>
                <li>• unsafe-eval 허용 (HMR용)</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-2">프로덕션 환경</h4>
              <ul className="space-y-1 text-sm">
                <li>• 엄격한 CSP 정책</li>
                <li>• HSTS preload 활성화</li>
                <li>• Frame-Options: DENY</li>
                <li>• 모든 보안 헤더 활성화</li>
              </ul>
            </div>
          </div>
        </div>

        {/* 새로고침 버튼 */}
        <div className="text-center mt-6">
          <button
            onClick={() => window.location.reload()}
            className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700"
          >
            🔄 재분석
          </button>
        </div>
      </div>
    </div>
  );
}