'use client';

import { useState, useEffect } from 'react';

interface TestData {
  name: string;
  email: string;
  age: number;
  bio: string;
  tags: string[];
  website: string;
  isActive: boolean;
  metadata: {
    source: string;
    category: 'personal' | 'business' | 'other';
  };
}

interface ValidationInfo {
  schema: any;
  examples: {
    valid: TestData;
    malicious: TestData;
  };
  sanitizationFeatures: string[];
}

export default function ValidationTestPage() {
  const [formData, setFormData] = useState<Partial<TestData>>({
    name: '',
    email: '',
    age: 25,
    bio: '',
    tags: [],
    website: '',
    isActive: true,
    metadata: {
      source: '',
      category: 'other',
    },
  });
  
  const [validationInfo, setValidationInfo] = useState<ValidationInfo | null>(null);
  const [testResults, setTestResults] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const addResult = (result: string) => {
    setTestResults(prev => [...prev, `${new Date().toLocaleTimeString()}: ${result}`]);
  };

  // Load validation info
  useEffect(() => {
    loadValidationInfo();
  }, []);

  const loadValidationInfo = async () => {
    try {
      const response = await fetch('/api/validation-test');
      if (response.ok) {
        const data = await response.json();
        setValidationInfo(data.data);
      }
    } catch (error) {
      console.error('Failed to load validation info:', error);
    }
  };

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleMetadataChange = (field: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      metadata: {
        ...prev.metadata!,
        [field]: value,
      },
    }));
  };

  const testValidation = async (testData: Partial<TestData>) => {
    try {
      setLoading(true);
      addResult('🔄 입력 검증 테스트 중...');

      const response = await fetch('/api/validation-test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(testData),
        credentials: 'include'
      });

      const result = await response.json();
      
      if (response.ok && result.success) {
        addResult('✅ 검증 성공');
        addResult(`📋 처리된 데이터: ${JSON.stringify(result.data, null, 2)}`);
      } else {
        addResult(`❌ 검증 실패: ${result.error?.message || 'Unknown error'}`);
        if (result.error?.details) {
          result.error.details.forEach((detail: any) => {
            addResult(`   • ${detail.field}: ${detail.message}`);
          });
        }
      }
    } catch (error) {
      addResult(`🚨 네트워크 오류: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const testCurrentData = () => {
    testValidation(formData);
  };

  const testValidExample = () => {
    if (validationInfo?.examples.valid) {
      addResult('📝 유효한 예제 데이터로 테스트');
      testValidation(validationInfo.examples.valid);
    }
  };

  const testMaliciousExample = () => {
    if (validationInfo?.examples.malicious) {
      addResult('💀 악의적 데이터로 테스트 (보안 필터 확인)');
      testValidation(validationInfo.examples.malicious);
    }
  };

  const loadValidExample = () => {
    if (validationInfo?.examples.valid) {
      setFormData(validationInfo.examples.valid);
      addResult('📝 유효한 예제 데이터를 폼에 로드했습니다');
    }
  };

  const loadMaliciousExample = () => {
    if (validationInfo?.examples.malicious) {
      setFormData(validationInfo.examples.malicious);
      addResult('💀 악의적 예제 데이터를 폼에 로드했습니다');
    }
  };

  const clearResults = () => {
    setTestResults([]);
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">
          🛡️ 입력 검증 & 세니타이제이션 테스트
        </h1>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* 입력 폼 */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">📝 테스트 데이터 입력</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  이름 (2-50자)
                </label>
                <input
                  type="text"
                  value={formData.name || ''}
                  onChange={(e) => handleInputChange('name', e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  placeholder="예: John Doe"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  이메일
                </label>
                <input
                  type="email"
                  value={formData.email || ''}
                  onChange={(e) => handleInputChange('email', e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  placeholder="예: john@example.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  나이 (0-150)
                </label>
                <input
                  type="number"
                  value={formData.age || ''}
                  onChange={(e) => handleInputChange('age', parseInt(e.target.value) || 0)}
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  min="0"
                  max="150"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  소개 (최대 1000자)
                </label>
                <textarea
                  value={formData.bio || ''}
                  onChange={(e) => handleInputChange('bio', e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 h-20"
                  placeholder="자기소개를 입력하세요..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  태그 (쉼표로 구분, 최대 5개)
                </label>
                <input
                  type="text"
                  value={formData.tags?.join(', ') || ''}
                  onChange={(e) => handleInputChange('tags', e.target.value.split(',').map(t => t.trim()).filter(t => t))}
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  placeholder="예: developer, javascript, react"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  웹사이트
                </label>
                <input
                  type="url"
                  value={formData.website || ''}
                  onChange={(e) => handleInputChange('website', e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  placeholder="https://example.com"
                />
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={formData.isActive || false}
                  onChange={(e) => handleInputChange('isActive', e.target.checked)}
                  className="mr-2"
                />
                <label className="text-sm font-medium text-gray-700">
                  활성 상태
                </label>
              </div>

              <div className="border-t pt-4">
                <h3 className="font-medium text-gray-700 mb-2">메타데이터</h3>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={formData.metadata?.source || ''}
                    onChange={(e) => handleMetadataChange('source', e.target.value)}
                    className="border border-gray-300 rounded px-2 py-1"
                    placeholder="소스"
                  />
                  <select
                    value={formData.metadata?.category || 'other'}
                    onChange={(e) => handleMetadataChange('category', e.target.value)}
                    className="border border-gray-300 rounded px-2 py-1"
                  >
                    <option value="personal">개인</option>
                    <option value="business">비즈니스</option>
                    <option value="other">기타</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="mt-6 space-y-2">
              <button
                onClick={testCurrentData}
                disabled={loading}
                className="w-full bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
              >
                현재 데이터로 검증 테스트
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={loadValidExample}
                  className="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700"
                >
                  유효한 예제 로드
                </button>
                <button
                  onClick={loadMaliciousExample}
                  className="bg-red-600 text-white px-3 py-1 rounded text-sm hover:bg-red-700"
                >
                  악의적 예제 로드
                </button>
              </div>
            </div>
          </div>

          {/* 보안 기능 정보 */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">🔒 보안 기능</h2>
            {validationInfo ? (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-green-700 mb-2">세니타이제이션 기능</h3>
                  <ul className="text-sm space-y-1">
                    {validationInfo.sanitizationFeatures.map((feature, index) => (
                      <li key={index} className="flex items-start">
                        <span className="text-green-600 mr-2">•</span>
                        {feature}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="pt-4">
                  <h3 className="font-semibold text-blue-700 mb-2">빠른 테스트</h3>
                  <div className="space-y-2">
                    <button
                      onClick={testValidExample}
                      disabled={loading}
                      className="w-full bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50"
                    >
                      ✅ 유효한 데이터 테스트
                    </button>
                    <button
                      onClick={testMaliciousExample}
                      disabled={loading}
                      className="w-full bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 disabled:opacity-50"
                    >
                      💀 악의적 데이터 테스트
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-gray-500">보안 기능 정보 로드 중...</div>
            )}
          </div>
        </div>

        {/* 테스트 결과 */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold">📊 테스트 결과</h2>
            <div className="flex items-center space-x-2">
              {loading && (
                <div className="flex items-center">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
                  <span className="text-sm text-gray-600">처리 중...</span>
                </div>
              )}
              <button
                onClick={clearResults}
                className="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600"
              >
                결과 지우기
              </button>
            </div>
          </div>
          
          <div className="bg-gray-900 text-green-400 p-4 rounded font-mono text-sm max-h-96 overflow-y-auto">
            {testResults.length === 0 ? (
              <div className="text-gray-500">위의 버튼을 클릭하여 입력 검증 테스트를 시작하세요...</div>
            ) : (
              testResults.map((result, index) => (
                <div key={index} className="mb-1">
                  {result}
                </div>
              ))
            )}
          </div>
        </div>

        {/* 보안 가이드 */}
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 mt-6">
          <h3 className="text-lg font-semibold text-yellow-800 mb-4">⚡ 보안 가이드</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-yellow-700">
            <div>
              <h4 className="font-semibold mb-2">입력 검증</h4>
              <ul className="space-y-1 text-sm">
                <li>• Zod 스키마로 타입 안전성 보장</li>
                <li>• 길이, 범위, 형식 검증</li>
                <li>• 화이트리스트 기반 허용</li>
                <li>• 중첩 객체 검증 지원</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-2">세니타이제이션</h4>
              <ul className="space-y-1 text-sm">
                <li>• DOMPurify로 XSS 방지</li>
                <li>• SQL injection 패턴 필터링</li>
                <li>• HTML 태그 제거/정화</li>
                <li>• 커스텀 세니타이저 지원</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}