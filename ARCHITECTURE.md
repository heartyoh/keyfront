# Keyfront BFF - 아키텍처 설계서

## 시스템 아키텍처 개요

### 고수준 아키텍처
```mermaid
graph TB
    subgraph "Client Tier"
        FE[React Frontend<br/>Next.js App]
    end
    
    subgraph "BFF Tier"
        BFF[Keyfront BFF<br/>Next.js Server]
        MW[Auth Middleware]
        GW[Gateway Proxy]
        AL[Audit Logger]
    end
    
    subgraph "Identity Tier"
        KC[Keycloak<br/>OIDC Provider]
        KCAdmin[Keycloak Admin API]
    end
    
    subgraph "Data Tier"
        REDIS[Redis<br/>Sessions & Cache]
        PG[PostgreSQL<br/>Audit & Config]
    end
    
    subgraph "Downstream"
        API1[User API]
        API2[Business API]
        API3[Report API]
    end
    
    FE -.->|"HTTP-Only Cookie<br/>Session ID"| BFF
    BFF --> MW
    MW --> GW
    GW --> AL
    BFF <-->|"OIDC Flow<br/>Token Exchange"| KC
    BFF <-->|"User/Role Mgmt"| KCAdmin
    BFF <-->|"Session Storage<br/>Rate Limiting"| REDIS
    BFF <-->|"Audit Log<br/>Tenant Config"| PG
    GW -->|"Bearer Token<br/>Forwarding"| API1
    GW -->|"Bearer Token<br/>Forwarding"| API2
    GW -->|"Bearer Token<br/>Forwarding"| API3
```

### 인증 플로우
```mermaid
sequenceDiagram
    participant FE as Frontend
    participant BFF as Keyfront BFF
    participant KC as Keycloak
    participant REDIS as Redis
    participant API as Downstream API

    Note over FE,API: 1. 로그인 플로우
    FE->>BFF: GET /api/auth/login
    BFF->>REDIS: Store CSRF token & OAuth state
    BFF->>FE: Redirect to Keycloak (with PKCE)
    FE->>KC: Authorization request
    KC->>FE: Redirect with auth code
    FE->>BFF: GET /api/auth/callback?code=xxx
    BFF->>REDIS: Validate OAuth state
    BFF->>KC: Exchange code for tokens (PKCE)
    KC->>BFF: Access/Refresh/ID tokens
    BFF->>REDIS: Store session with tokens
    BFF->>FE: Set HTTP-Only session cookie

    Note over FE,API: 2. API 호출 플로우
    FE->>BFF: API request with session cookie
    BFF->>REDIS: Validate session & get tokens
    BFF->>API: Forward request with Bearer token
    API->>BFF: API response
    BFF->>FE: Forward response
```

## 컴포넌트 설계

### 1. 세션 관리 (Session Management)

#### Redis 키 구조
```
sess:{sessionId}        → UserSession 객체 (JSON)
csrf:{sessionId}        → CSRF 토큰 (String)
oauth:state:{state}     → OAuth State 데이터 (JSON)
ratelimit:{key}:{window} → Rate limit 카운터 (Number)
```

#### 세션 객체 구조
```typescript
interface UserSession {
  id: string;                    // 세션 ID
  sub: string;                   // Keycloak subject ID
  tenantId: string;              // 테넌트 식별자
  email?: string;                // 사용자 이메일
  name?: string;                 // 사용자 이름
  roles: string[];               // 역할 목록 (realm + client roles)
  permissions: string[];         // 권한 목록 (계산된 권한)
  accessTokenRef: string;        // Access 토큰 (암호화 권장)
  refreshTokenRef: string;       // Refresh 토큰 (암호화 권장)
  expiresAt: number;            // 세션 만료 시간
  createdAt: number;            // 세션 생성 시간
  lastActivity: number;         // 마지막 활동 시간
}
```

### 2. 인증 미들웨어 (Authentication Middleware)

#### 미들웨어 체인
```typescript
// 요청 처리 파이프라인
Request → SecurityHeaders → CORS → RateLimit → Session → Authorization → Handler
```

#### 권한 검사 전략
```typescript
// RBAC (Role-Based Access Control)
requireRole(['ADMIN', 'USER'])

// TBAC (Tenant-Based Access Control)  
requireTenant(tenantId?)

// ABAC (Attribute-Based Access Control) - 향후 확장
requireAttribute({
  resource: 'document',
  action: 'read',
  context: { department: 'finance' }
})
```

### 3. 게이트웨이 프록시 (Gateway Proxy)

#### 라우팅 전략
```typescript
/api/gateway/users/*     → USER_API_BASE/api/v1/users/*
/api/gateway/documents/* → DOC_API_BASE/api/v1/documents/*
/api/gateway/reports/*   → REPORT_API_BASE/api/v1/reports/*
```

#### 토큰 주입 방식
```http
# Original Request
GET /api/gateway/users/profile
Cookie: keyfront.sid=abc123...

# Proxied Request  
GET /api/v1/users/profile
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
X-Tenant-ID: tenant-001
X-User-ID: user-123
X-Trace-ID: trace-456
```

### 4. Rate Limiting

#### Sliding Window 알고리즘
```typescript
interface RateLimitConfig {
  ip: { requests: 1000, window: '1h' };           // IP별 제한
  user: { requests: 500, window: '1h' };          // 사용자별 제한  
  tenant: { requests: 10000, window: '1h' };      // 테넌트별 제한
  endpoint: { requests: 100, window: '1m' };      // 엔드포인트별 제한
}
```

#### Rate Limit 헤더
```http
HTTP/1.1 200 OK
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999  
X-RateLimit-Reset: 1640995200
X-RateLimit-Window: 3600
```

### 5. 감사 로깅 (Audit Logging)

#### 로그 스키마
```typescript
interface AuditLog {
  id: string;                    // 로그 ID
  timestamp: Date;               // 이벤트 시간
  traceId: string;              // 분산 추적 ID
  tenantId: string;             // 테넌트 ID
  userId: string;               // 사용자 ID (sub)
  action: string;               // 액션 (login, api_call, logout)
  resourceType: string;         // 리소스 타입 (user, document, etc.)
  resourceId?: string;          // 리소스 ID
  result: 'allow' | 'deny' | 'error';  // 결과
  reason?: string;              // 실패/거부 사유
  metadata: {                   // 추가 메타데이터
    ipAddress?: string;
    userAgent?: string;
    method?: string;
    path?: string;
    statusCode?: number;
    duration?: number;
  };
}
```

## 보안 설계

### 1. 토큰 보안
- **Access Token**: Redis에 암호화 저장, 브라우저 미노출
- **Refresh Token**: Redis에 암호화 저장, 자동 로테이션
- **Session Cookie**: HTTP-Only, Secure, SameSite=Lax

### 2. CSRF 방어
- Double Submit Cookie 패턴
- State 매개변수 검증
- Origin/Referer 헤더 검증

### 3. 보안 헤더
```http
Strict-Transport-Security: max-age=31536000; includeSubDomains
Content-Security-Policy: default-src 'self'
X-Frame-Options: DENY  
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=()
```

## 확장성 설계

### 1. 멀티테넌시 모델
```typescript
// Single Realm + Tenant Claim 모델 (권장)
{
  "sub": "user-123",
  "tenantId": "tenant-001",
  "realm_access": { "roles": ["USER"] },
  "resource_access": {
    "tenant-001-app": { "roles": ["EDITOR"] }
  }
}

// 도메인 기반 테넌트 매핑
tenant-a.example.com → tenantId: "tenant-a"
tenant-b.example.com → tenantId: "tenant-b"
```

### 2. 수평 확장 전략
- **Stateless BFF**: 세션은 Redis에 중앙 집중
- **Redis Clustering**: 고가용성을 위한 Redis Sentinel/Cluster
- **Load Balancing**: Sticky Session 불필요

### 3. 캐싱 전략
```typescript
// JWKS 캐싱 (공개키 검증용)
jwks:keycloak:keys → 30분 TTL

// 사용자 정보 캐싱  
user:profile:{sub} → 5분 TTL

// 권한 정보 캐싱
user:permissions:{sub}:{tenantId} → 10분 TTL
```

## 성능 최적화

### 1. 연결 풀링
- **Redis**: ioredis 연결 풀 (최대 10개 연결)
- **HTTP Client**: Keep-Alive, 연결 재사용
- **PostgreSQL**: 연결 풀링 (pg-pool)

### 2. 비동기 처리
- **감사 로그**: 백그라운드 처리 (Event Queue)
- **토큰 갱신**: 백그라운드 자동 갱신
- **세션 정리**: 배치 작업 (Cron)

### 3. 응답 시간 목표
- **인증 확인**: < 50ms (Redis 조회)
- **API 프록시**: < 150ms (다운스트림 API + 오버헤드)
- **로그인 콜백**: < 300ms (토큰 교환 + 세션 생성)

## 컨테이너 아키텍처 (✅ 구현 완료)

### 1. Docker Multi-stage 빌드
```dockerfile
# Stage 1: Base dependencies
FROM node:20-alpine AS base

# Stage 2: Production dependencies only  
FROM base AS deps
RUN npm ci --only=production

# Stage 3: Build stage with full dependencies
FROM base AS builder
RUN npm ci --frozen-lockfile
RUN npm run build

# Stage 4: Production runtime
FROM node:20-alpine AS runtime
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next/standalone ./
```

### 2. 컨테이너 보안 설계
```yaml
# 보안 최적화
- 비특권 사용자 실행: nextjs (UID: 1001)
- 최소한의 런타임 패키지: Alpine Linux
- 보안 업데이트 자동 적용
- 읽기 전용 파일시스템 (로그 디렉토리 제외)
- 불필요한 파일 제외: .dockerignore 최적화
```

### 3. 컨테이너 Health Check
```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3000/api/health/live || exit 1
```

### 4. 환경 변수 설계
```typescript
interface ContainerEnv {
  // 서버 설정
  NODE_ENV: 'production' | 'development';
  PORT: number;                    // 기본값: 3000
  HOSTNAME: string;               // 기본값: '0.0.0.0'
  
  // 보안 설정
  SESSION_SECRET: string;         // 32자 이상 필수
  CORS_ORIGINS: string[];         // 쉼표로 구분
  
  // 외부 서비스 연동
  REDIS_URL: string;              // Redis 연결 URL
  KC_ISSUER_URL: string;          // Keycloak Issuer
  KC_CLIENT_ID: string;           // OAuth Client ID
  KC_CLIENT_SECRET: string;       // OAuth Client Secret
  
  // 선택적 설정
  DATABASE_URL?: string;          // PostgreSQL (감사로그용)
  LOG_LEVEL?: 'debug' | 'info' | 'warn' | 'error';
}
```

## 배포 아키텍처

### 1. Docker Compose 스택
```yaml
services:
  keyfront-bff:
    image: keyfront-bff:latest
    ports: ["3000:3000"]
    depends_on: [redis, keycloak]
    
  redis:
    image: redis:7-alpine
    volumes: [redis_data:/data]
    
  keycloak:
    image: keycloak/keycloak:23
    environment: [KC_DB=postgres]
    depends_on: [postgres]
    
  postgres:
    image: postgres:15-alpine
    volumes: [postgres_data:/var/lib/postgresql/data]
```

### 2. Kubernetes 배포 패턴 (🚧 개발 예정)
```yaml
# Deployment 리소스
apiVersion: apps/v1
kind: Deployment
metadata:
  name: keyfront-bff
spec:
  replicas: 3
  template:
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 1001
      containers:
      - name: keyfront-bff
        image: keyfront-bff:latest
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "512Mi" 
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /api/health/live
            port: 3000
          initialDelaySeconds: 10
        readinessProbe:
          httpGet:
            path: /api/health/ready
            port: 3000
          initialDelaySeconds: 5
```

### 3. Service Mesh 통합 (Future)
```yaml
# Istio 설정 예시
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: keyfront-bff
spec:
  http:
  - match:
    - uri:
        prefix: /api/auth
    route:
    - destination:
        host: keyfront-bff
    timeout: 30s
    retries:
      attempts: 3
      perTryTimeout: 10s
```

## 장애 대응 설계

### 1. Circuit Breaker 패턴
```typescript
// Keycloak 장애시
if (keycloakDown) {
  // 기존 세션은 유지 (Grace Period)
  // 신규 로그인은 임시 차단
  return gracefulDegradation();
}
```

### 2. 백업 전략
- **Redis 백업**: RDB + AOF 스냅샷
- **PostgreSQL 백업**: 일일 풀백업 + WAL
- **설정 백업**: 환경변수 및 키 관리
- **컨테이너 이미지**: 버전별 태그 관리 및 롤백

### 3. 모니터링 지표
- **Golden Signals**: Latency, Traffic, Errors, Saturation
- **비즈니스 메트릭**: 로그인 성공률, 토큰 갱신 실패율
- **보안 메트릭**: 403/401 비율, Rate Limit 히트율
- **컨테이너 메트릭**: CPU/Memory 사용률, 재시작 횟수

### 4. 컨테이너 특화 장애 대응
```yaml
# Kubernetes 자동 복구
- 컨테이너 크래시: 자동 재시작 (restartPolicy: Always)
- 헬스체크 실패: 자동 교체 (livenessProbe)
- 리소스 부족: HPA 자동 스케일링
- 노드 장애: Pod 재스케줄링
```

---
*Architecture Version: v1.1*  
*Last Updated: 2024-12-25 (Docker 컨테이너화 완성)*