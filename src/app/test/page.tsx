'use client';

import { useState, useEffect, useRef } from 'react';

interface User {
  sub: string;
  name: string;
  email: string;
  tenantId: string;
  roles: string[];
}

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    traceId?: string;
  };
}

export default function TestPage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiResponse, setApiResponse] = useState<string>('');
  const [wsConnected, setWsConnected] = useState(false);
  const [wsMessages, setWsMessages] = useState<string[]>([]);
  const [wsMessage, setWsMessage] = useState('');
  const wsRef = useRef<WebSocket | null>(null);

  // Check authentication status
  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/me', {
        credentials: 'include'
      });
      const data: ApiResponse<User> = await response.json();
      
      if (data.success && data.data) {
        setUser(data.data);
      } else {
        setUser(null);
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const login = () => {
    window.location.href = '/api/auth/login';
  };

  const logout = async () => {
    // 임시로 쿠키 삭제로 로그아웃 시뮬레이션
    document.cookie = 'keyfront.sid=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    setUser(null);
    setWsConnected(false);
    if (wsRef.current) {
      wsRef.current.close();
    }
  };

  const testApiCall = async (endpoint: string) => {
    try {
      setApiResponse('요청 중...');
      const response = await fetch(`/api/gateway${endpoint}`, {
        credentials: 'include'
      });
      const data = await response.json();
      setApiResponse(JSON.stringify(data, null, 2));
    } catch (error) {
      setApiResponse(`Error: ${error}`);
    }
  };

  const connectWebSocket = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws`);
    
    ws.onopen = () => {
      setWsConnected(true);
      setWsMessages(prev => [...prev, '✅ WebSocket 연결됨']);
    };

    ws.onmessage = (event) => {
      setWsMessages(prev => [...prev, `📨 수신: ${event.data}`]);
    };

    ws.onclose = () => {
      setWsConnected(false);
      setWsMessages(prev => [...prev, '❌ WebSocket 연결 종료']);
    };

    ws.onerror = (error) => {
      setWsMessages(prev => [...prev, `🚨 WebSocket 에러: ${error}`]);
    };

    wsRef.current = ws;
  };

  const sendWsMessage = () => {
    if (wsRef.current && wsMessage.trim()) {
      wsRef.current.send(JSON.stringify({
        type: 'message',
        payload: wsMessage
      }));
      setWsMessages(prev => [...prev, `📤 전송: ${wsMessage}`]);
      setWsMessage('');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">인증 상태 확인 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">
          Keyfront BFF 테스트 페이지
        </h1>

        {/* 인증 상태 */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">🔐 인증 상태</h2>
          {user ? (
            <div>
              <div className="bg-green-50 border border-green-200 rounded p-4 mb-4">
                <p className="text-green-800">✅ 로그인 상태</p>
                <p><strong>사용자:</strong> {user.name} ({user.email})</p>
                <p><strong>테넌트:</strong> {user.tenantId}</p>
                <p><strong>역할:</strong> {user.roles.join(', ')}</p>
              </div>
              <button
                onClick={logout}
                className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
              >
                로그아웃
              </button>
            </div>
          ) : (
            <div>
              <div className="bg-yellow-50 border border-yellow-200 rounded p-4 mb-4">
                <p className="text-yellow-800">⚠️ 로그인 필요</p>
              </div>
              <button
                onClick={login}
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
              >
                로그인
              </button>
            </div>
          )}
        </div>

        {/* HTTP API 테스트 */}
        {user && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">🌐 HTTP API 테스트</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <button
                onClick={() => testApiCall('/api/users')}
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
              >
                GET /api/users
              </button>
              <button
                onClick={() => testApiCall('/api/orders')}
                className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
              >
                GET /api/orders
              </button>
            </div>
            {apiResponse && (
              <div className="bg-gray-100 rounded p-4 overflow-auto">
                <h3 className="font-semibold mb-2">API 응답:</h3>
                <pre className="text-sm">{apiResponse}</pre>
              </div>
            )}
          </div>
        )}

        {/* WebSocket 테스트 */}
        {user && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">🔌 WebSocket 테스트</h2>
            <div className="mb-4">
              <button
                onClick={connectWebSocket}
                disabled={wsConnected}
                className={`px-4 py-2 rounded mr-2 ${
                  wsConnected 
                    ? 'bg-gray-400 cursor-not-allowed' 
                    : 'bg-purple-600 hover:bg-purple-700'
                } text-white`}
              >
                {wsConnected ? '연결됨' : 'WebSocket 연결'}
              </button>
              {wsConnected && (
                <button
                  onClick={() => wsRef.current?.close()}
                  className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
                >
                  연결 해제
                </button>
              )}
            </div>
            
            {wsConnected && (
              <div className="mb-4">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={wsMessage}
                    onChange={(e) => setWsMessage(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && sendWsMessage()}
                    placeholder="메시지 입력..."
                    className="flex-1 border border-gray-300 rounded px-3 py-2"
                  />
                  <button
                    onClick={sendWsMessage}
                    className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
                  >
                    전송
                  </button>
                </div>
              </div>
            )}

            <div className="bg-gray-100 rounded p-4 h-64 overflow-y-auto">
              <h3 className="font-semibold mb-2">WebSocket 로그:</h3>
              {wsMessages.map((msg, index) => (
                <div key={index} className="text-sm mb-1">
                  {msg}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}