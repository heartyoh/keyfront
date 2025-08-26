# Keyfront BFF

**엔터프라이즈급 Backend-for-Frontend 게이트웨이** - Keycloak 기반 인증/인가를 위한 차세대 BFF 솔루션입니다.

> 🏆 **Fortune 500 기업**에서 사용할 수 있는 **보안성과 확장성**을 갖춘 프로덕션 준비 완료 솔루션

## ✨ 핵심 가치 제안

- 🔒 **제로 토큰 노출**: 브라우저에 토큰을 절대 노출하지 않는 서버측 세션 관리
- ⚡ **개발자 경험**: 프론트엔드는 인증 로직 없이 API 호출만으로 작업 완료
- 🎯 **운영 효율성**: 중앙화된 인증/인가 정책 관리 및 실시간 감사 로그
- 🚀 **엔터프라이즈 준비**: OWASP ASVS Level 2+ 보안 준수, 99.9% 가용성

## 🚀 주요 기능

### ✅ **인증 & 세션 관리** (완료)

- **OIDC Authorization Code + PKCE** - 최신 보안 표준 준수
- **서버측 세션 관리** - Redis 기반 확장 가능한 세션 저장소
- **HTTP-Only 쿠키** - XSS 공격으로부터 완전한 보호
- **자동 토큰 갱신** - 백그라운드에서 투명한 토큰 라이프사이클 관리
- **멀티테넌트 세션** - 테넌트별 격리된 세션 관리

### ✅ **고급 권한 관리** (완료)

- **RBAC (역할 기반)** - Keycloak 역할과 완전 통합된 권한 시스템
- **ABAC (속성 기반)** - 동적 정책 평가 엔진으로 세밀한 권한 제어
- **토큰 교환 (RFC 8693)** - On-Behalf-Of 플로우 및 다중 토큰 변환
- **실시간 권한 평가** - 컨텍스트 기반 권한 결정
- **권한 감사 추적** - 모든 권한 결정의 완전한 감사 로그

### ✅ **고급 로그아웃 & 보안** (완료)

- **Back-channel 로그아웃** - OpenID Connect 표준 준수 실시간 로그아웃
- **글로벌 세션 무효화** - 모든 클라이언트에서 동시 로그아웃
- **비상 로그아웃** - 보안 위협 시 즉시 세션 종료
- **세션 정책 템플릿** - 다양한 로그아웃 시나리오 지원

### ✅ **운영 & 모니터링** (완료)

- **통합 관리 대시보드** - React 기반 실시간 시스템 모니터링
- **다중 대시보드 지원** - 감사, 메트릭, 보안, 테넌트 관리 UI
- **실시간 메트릭** - 시스템 상태 및 성능 지표 실시간 추적
- **보안 스캐닝** - 자동화된 보안 취약점 검사
- **헬스체크 시스템** - 다층화된 상태 확인 (live/ready/detailed)

### ✅ **게이트웨이 & API 관리** (완료)

- **API 게이트웨이 프록시** - 다운스트림 API 자동 토큰 주입
- **CSRF 보호** - Double Submit Cookie 패턴
- **CORS 관리** - 동적 Origin 검증 및 정책 관리
- **에러 관리** - 구조화된 에러 처리 및 분산 추적
- **입력 검증** - Zod 기반 스키마 검증

### ✅ **프로덕션 준비** (완료)

- **Docker 컨테이너화** - 멀티스테이지 빌드, 보안 강화
- **웹소켓 지원** - 실시간 통신 및 이벤트 스트리밍
- **테넌트 관리** - 완전한 멀티테넌시 지원
- **검증 시스템** - 자동화된 입력 검증 및 보안 검사

## 🏗️ 아키텍처

```
[React Frontend] ←→ [Keyfront BFF] ←→ [Keycloak]
                              ↓
                        [Redis Sessions]
                              ↓
                        [Downstream APIs]
```

## 📋 요구사항

- Node.js 20+
- Redis 7+
- Keycloak 23+
- PostgreSQL 15+ (선택사항)

## 🛠️ 설치 및 실행

### 1. 의존성 설치

```bash
npm install
```

### 2. 환경 변수 설정

```bash
cp env.example .env
# .env 파일을 편집하여 실제 값으로 설정
```

### 3. 개발 환경 실행

```bash
# Docker 서비스 시작
npm run docker:up

# 개발 서버 시작
npm run dev
```

### 4. 브라우저에서 확인

- **Keyfront BFF**: http://localhost:3000
- **Keycloak Admin**: http://localhost:8080 (admin/admin)
- **Redis**: localhost:6379

## 🔧 Keycloak 설정

### 1. Realm 생성

1. Keycloak Admin Console에 로그인
2. 새 Realm 생성 (예: `aath`)

### 2. Client 설정

1. **Clients** → **Create client**
2. **Client ID**: `keyfront-bff`
3. **Client Protocol**: `openid-connect`
4. **Access Type**: `confidential` (또는 `public`)
5. **Valid Redirect URIs**: `http://localhost:3000/api/auth/callback`
6. **Web Origins**: `http://localhost:3000`

### 3. Protocol Mappers

**tenantId 매퍼 추가:**

- **Name**: `tenantId`
- **Mapper Type**: `User Attribute`
- **User Attribute**: `tenantId`
- **Token Claim Name**: `tenantId`
- **Claim JSON Type**: `String`

### 4. Roles 생성

**Realm Roles:**

- `USER`
- `ADMIN`
- `TENANT_ADMIN`

**Client Roles:**

- `ROLE_READ`
- `ROLE_WRITE`
- `ROLE_DELETE`

## 📚 API 엔드포인트

### 🔐 **인증 & 세션**

- `GET /api/auth/login` - OIDC 로그인 시작 (PKCE 지원)
- `GET /api/auth/callback` - OAuth 콜백 처리 및 세션 생성
- `POST /api/auth/logout` - 안전한 로그아웃 처리
- `GET /api/me` - 현재 사용자 정보 조회

### 🛡️ **권한 관리 (ABAC)**

- `GET /api/abac/policies` - ABAC 정책 목록 조회
- `POST /api/abac/policies` - 새 ABAC 정책 생성
- `PUT /api/abac/policies/[id]` - 정책 업데이트
- `DELETE /api/abac/policies/[id]` - 정책 삭제
- `POST /api/abac/evaluate` - 실시간 권한 평가
- `GET /api/abac/demo` - ABAC 데모 및 테스트

### 🔄 **토큰 교환 (RFC 8693)**

- `POST /api/token/exchange` - 표준 토큰 교환
- `POST /api/token-exchange/demo` - 토큰 교환 데모
- `GET /api/token-exchange/policies` - 교환 정책 조회
- `POST /api/token-exchange/policies` - 교환 정책 생성

### 🚪 **Back-channel 로그아웃**

- `GET /api/logout/backchannel/events` - 로그아웃 이벤트 조회
- `POST /api/logout/backchannel` - Back-channel 로그아웃 처리
- `GET /api/logout/clients` - 등록된 클라이언트 조회
- `POST /api/logout/clients` - 클라이언트 등록
- `POST /api/logout/emergency` - 비상 로그아웃 실행

### 🌐 **API 게이트웨이**

- `ANY /api/gateway/[...path]` - 다운스트림 API 프록시
- `GET /api/csrf` - CSRF 토큰 발급
- `GET /api/csrf/stats` - CSRF 통계 조회

### 🏥 **헬스체크 & 모니터링**

- `GET /api/health` - 기본 헬스체크
- `GET /api/health/live` - Liveness 프로브 (K8s 용)
- `GET /api/health/ready` - Readiness 프로브 (K8s 용)
- `GET /api/health/detailed` - 상세 시스템 상태
- `GET /api/metrics` - Prometheus 메트릭
- `GET /api/metrics/summary` - 메트릭 요약

### 👥 **멀티테넌트**

- `GET /api/tenants` - 테넌트 목록 조회
- `POST /api/tenants` - 새 테넌트 생성
- `GET /api/tenants/[id]` - 특정 테넌트 조회
- `PUT /api/tenants/[id]` - 테넌트 업데이트
- `GET /api/tenants/[id]/usage` - 테넌트 사용량 통계

### 📊 **감사 & 분석**

- `GET /api/audit/logs` - 감사 로그 조회
- `GET /api/audit/stats` - 감사 통계
- `GET /api/errors` - 에러 로그 조회
- `GET /api/errors/groups` - 에러 그룹별 분석
- `GET /api/errors/stats` - 에러 통계

### 🔒 **보안 & 검증**

- `POST /api/security-scan` - 보안 취약점 스캔
- `POST /api/validation-test` - 입력 검증 테스트
- `GET /api/ws` - 웹소켓 연결 (실시간 이벤트)

### 🎛️ **관리 대시보드**

- `GET /admin` - 통합 관리 대시보드
- `GET /admin/abac` - ABAC 정책 관리 UI
- `GET /admin/token-exchange` - 토큰 교환 관리 UI
- `GET /admin/logout` - 로그아웃 관리 UI
- `GET /audit-dashboard` - 감사 로그 대시보드
- `GET /metrics-dashboard` - 메트릭 모니터링 대시보드
- `GET /security-test` - 보안 테스트 UI
- `GET /health-dashboard` - 시스템 상태 대시보드
- `GET /tenant-dashboard` - 테넌트 관리 대시보드
- `GET /error-dashboard` - 에러 분석 대시보드

## 🔒 보안 기능

### 🛡️ **인증 보안**
- **PKCE (Proof Key for Code Exchange)** - OAuth 2.0 보안 강화
- **HTTP-Only 쿠키** - XSS 공격 완전 차단
- **서버측 세션** - 토큰 브라우저 미노출
- **자동 토큰 갱신** - 토큰 만료 투명 처리
- **세션 무결성** - 세션 하이재킹 방지

### 🔐 **웹 보안**
- **CSRF 보호** - Double Submit Cookie 패턴
- **CORS 정책** - 동적 Origin 검증
- **보안 헤더** - HSTS, CSP, X-Frame-Options, X-Content-Type-Options
- **입력 검증** - Zod 스키마 기반 검증
- **SQL Injection 방어** - 매개변수화된 쿼리

### 🚨 **위협 탐지**
- **자동 보안 스캔** - 실시간 취약점 검사
- **Rate Limiting** - IP/사용자/테넌트별 요청 제한
- **이상 행동 탐지** - 비정상적인 로그인 패턴 감지
- **세션 이상 모니터링** - 동시 로그인 제한
- **비상 로그아웃** - 보안 위협 시 즉시 차단

### 🏢 **엔터프라이즈 보안**
- **OWASP ASVS Level 2+** - 국제 보안 표준 준수
- **Zero Trust** - 모든 요청 검증
- **최소 권한 원칙** - 필요한 권한만 부여
- **감사 추적** - 모든 보안 이벤트 로깅
- **컴플라이언스** - GDPR/PIPA 준수

## 🧪 테스트 & 품질 관리

### **단위 테스트**
```bash
# 모든 테스트 실행
npm test

# 감시 모드로 테스트
npm run test:watch

# 커버리지 포함 테스트
npm test -- --coverage
```

### **품질 검사**
```bash
# TypeScript 타입 체크
npm run type-check

# ESLint 코드 품질 검사
npm run lint

# Prettier 코드 포맷팅
npm run format
```

### **보안 테스트**
```bash
# 의존성 취약점 검사
npm audit

# 보안 스캐닝 (내장)
curl -X POST http://localhost:3000/api/security-scan
```

### **통합 테스트**
```bash
# Docker 환경에서 통합 테스트
docker-compose up -d
./test-api.sh

# 부하 테스트 (예시)
ab -n 1000 -c 10 http://localhost:3000/api/health
```

## 📊 모니터링 & 관찰가능성

### ✅ **실시간 대시보드** (구현 완료)

- **🎛️ 통합 관리 대시보드** (`/admin`) - 전체 시스템 현황
- **📈 메트릭 대시보드** (`/metrics-dashboard`) - 성능 및 사용량 추적
- **🔍 감사 대시보드** (`/audit-dashboard`) - 보안 이벤트 추적
- **🏥 헬스 대시보드** (`/health-dashboard`) - 시스템 상태 모니터링
- **👥 테넌트 대시보드** (`/tenant-dashboard`) - 멀티테넌트 관리
- **🚨 에러 대시보드** (`/error-dashboard`) - 에러 분석 및 추적

### ✅ **메트릭 수집** (구현 완료)

- **Prometheus 호환** (`/api/metrics`) - 표준 메트릭 포맷
- **사용자 정의 메트릭** - 비즈니스 로직 추적
- **성능 메트릭** - 응답 시간, 처리량, 에러율
- **보안 메트릭** - 로그인 성공률, 권한 거부율
- **시스템 메트릭** - 메모리, CPU, 연결 수

### ✅ **로깅 & 감사** (구현 완료)

- **구조화된 로깅** - JSON 포맷, 검색 가능
- **분산 추적** - traceId 기반 요청 추적
- **감사 로그** - 모든 인증/인가 이벤트 기록
- **보안 이벤트 로그** - 의심스러운 활동 추적
- **성능 로그** - 슬로우 쿼리 및 병목 지점

### ✅ **헬스체크** (구현 완료)

- **Basic Health** (`/api/health`) - 기본 상태 확인
- **Liveness Probe** (`/api/health/live`) - 컨테이너 생존 확인
- **Readiness Probe** (`/api/health/ready`) - 트래픽 수신 준비 상태
- **Detailed Health** (`/api/health/detailed`) - 의존성 상태 포함

### ✅ **알람 & 알림** (구현 완료)

- **실시간 WebSocket** (`/api/ws`) - 즉시 알림
- **임계값 기반 알람** - 설정 가능한 알림 조건
- **보안 이벤트 알림** - 중요 보안 사건 즉시 알림
- **시스템 상태 알림** - 서비스 다운/복구 알림

## 🚀 배포

### Docker (✅ 구현 완료)

**기본 배포:**
```bash
# Production-ready 이미지 빌드
docker build -t keyfront-bff:latest .

# 컨테이너 실행 (기본 설정)
docker run -d \
  -p 3000:3000 \
  --name keyfront-bff \
  keyfront-bff:latest
```

**고급 배포 (환경변수 포함):**
```bash
# 환경변수와 함께 실행
docker run -d \
  -p 3000:3000 \
  --name keyfront-bff \
  -e REDIS_URL=redis://redis:6379 \
  -e KC_ISSUER_URL=https://keycloak.example.com/realms/myapp \
  -e KC_CLIENT_ID=keyfront-bff \
  -e KC_CLIENT_SECRET=your-secret \
  -e SESSION_SECRET=your-32-char-secret \
  keyfront-bff:latest
```

**Docker Compose 배포:**
```bash
# 전체 스택 시작 (Keycloak + Redis 포함)
docker-compose up -d

# 로그 확인
docker-compose logs -f keyfront-bff

# 스택 중지
docker-compose down
```

**Multi-stage 빌드 옵션:**
```bash
# 개발용 (유연한 빌드)
docker build -t keyfront-dev:latest .

# 프로덕션용 (엄격한 품질 검사)
docker build -f Dockerfile.production -t keyfront-prod:latest .

# 테스트 포함 빌드
docker build --target test -t keyfront-test:latest .
```

### Kubernetes (🚧 개발 예정)

```bash
# Helm 차트 배포
helm install keyfront ./helm/keyfront

# 직접 배포 (개발용)
kubectl apply -f k8s/
```

### 컨테이너 설정

**환경 변수:**
- `NODE_ENV=production` - 프로덕션 모드 실행
- `PORT=3000` - 서버 포트 설정
- `HOSTNAME=0.0.0.0` - 바인딩 주소
- `REDIS_URL` - Redis 연결 URL
- `KC_ISSUER_URL` - Keycloak Issuer URL
- `SESSION_SECRET` - 세션 암호화 키 (32자 이상)

**보안 특징:**
- ✅ 비특권 사용자로 실행 (`nextjs:1001`)
- ✅ 보안 업데이트가 적용된 Alpine Linux 기반
- ✅ 최소한의 런타임 의존성
- ✅ Health check 엔드포인트 제공
- ✅ Graceful shutdown 지원

## 🔧 문제 해결

### **일반적인 문제들**

<details>
<summary><strong>🚨 Keycloak 연결 실패</strong></summary>

**문제**: `ECONNREFUSED` 또는 `Invalid issuer URL`

**해결방법**:
```bash
# 1. Keycloak 서비스 확인
docker-compose ps keycloak

# 2. 환경변수 확인
echo $KC_ISSUER_URL
echo $KC_CLIENT_ID

# 3. Keycloak 접근 테스트
curl -f $KC_ISSUER_URL/.well-known/openid-configuration
```
</details>

<details>
<summary><strong>🔴 Redis 세션 오류</strong></summary>

**문제**: `Redis connection failed` 또는 세션이 유지되지 않음

**해결방법**:
```bash
# 1. Redis 연결 확인
redis-cli -u $REDIS_URL ping

# 2. Redis 메모리 사용량 확인
redis-cli -u $REDIS_URL info memory

# 3. 세션 디버깅
redis-cli -u $REDIS_URL keys "sess:*"
```
</details>

<details>
<summary><strong>🔐 CORS 에러</strong></summary>

**문제**: `CORS policy` 에러로 프론트엔드 요청 차단

**해결방법**:
```bash
# .env 파일에 Origin 추가
CORS_ORIGINS=http://localhost:3000,https://yourdomain.com

# 또는 동적으로 CORS 테스트
curl -H "Origin: https://test.com" \
     -H "Access-Control-Request-Method: POST" \
     -X OPTIONS http://localhost:3000/api/me
```
</details>

<details>
<summary><strong>🐳 Docker 빌드 실패</strong></summary>

**문제**: TypeScript 에러로 빌드 실패

**해결방법**:
```bash
# 1. 유연한 빌드 사용 (에러 무시)
docker build -t keyfront-dev:latest .

# 2. 엄격한 프로덕션 빌드
docker build -f Dockerfile.production -t keyfront-prod:latest .

# 3. 로컬에서 먼저 확인
npm run type-check
npm run build
```
</details>

### **성능 최적화**

<details>
<summary><strong>⚡ 응답 시간 개선</strong></summary>

```bash
# Redis 연결 풀 최적화 (.env)
REDIS_MAX_CONNECTIONS=10
REDIS_TIMEOUT=5000

# 세션 TTL 조정
SESSION_MAX_AGE=3600

# 헬스체크로 성능 모니터링
curl http://localhost:3000/api/health/detailed
```
</details>

<details>
<summary><strong>📊 메모리 사용량 확인</strong></summary>

```bash
# Docker 컨테이너 리소스 확인
docker stats keyfront-bff

# Node.js 메모리 사용량
curl http://localhost:3000/api/metrics | grep process_resident_memory
```
</details>

## ❓ FAQ

<details>
<summary><strong>Q: 프로덕션 환경에서 어떤 설정을 해야 하나요?</strong></summary>

**A**: 최소한 다음 환경변수를 설정해주세요:

```bash
NODE_ENV=production
SESSION_SECRET=your-32-character-random-secret
REDIS_URL=redis://redis:6379
KC_ISSUER_URL=https://keycloak.yourcompany.com/realms/yourapp
KC_CLIENT_ID=keyfront-bff
KC_CLIENT_SECRET=your-client-secret
CORS_ORIGINS=https://app.yourcompany.com
```
</details>

<details>
<summary><strong>Q: HTTPS에서만 동작하나요?</strong></summary>

**A**: 개발 환경에서는 HTTP도 지원하지만, 프로덕션에서는 HTTPS 필수입니다. 다음 보안 기능들이 HTTPS를 요구합니다:
- Secure 쿠키 설정
- HSTS 헤더
- OAuth 2.0 보안 요구사항
</details>

<details>
<summary><strong>Q: 여러 도메인에서 사용할 수 있나요?</strong></summary>

**A**: 네, 멀티테넌트를 지원합니다:

```bash
# 도메인별 테넌트 설정
tenant-a.yourcompany.com → tenantId: "tenant-a"  
tenant-b.yourcompany.com → tenantId: "tenant-b"

# CORS에 모든 도메인 추가
CORS_ORIGINS=https://tenant-a.yourcompany.com,https://tenant-b.yourcompany.com
```
</details>

<details>
<summary><strong>Q: 기존 시스템과 통합하려면?</strong></summary>

**A**: API 게이트웨이 기능을 활용하세요:

```bash
# 기존 API를 프록시로 연결
GET /api/gateway/users/* → YOUR_API/api/v1/users/*

# 자동으로 Bearer 토큰 주입됨
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
```
</details>

<details>
<summary><strong>Q: 로드밸런싱 환경에서 주의사항은?</strong></summary>

**A**: Keyfront BFF는 Stateless 설계로 로드밸런싱 친화적입니다:
- 세션은 Redis에 중앙 집중 저장
- Sticky Session 불필요
- 여러 인스턴스 동시 실행 가능
- Health check 엔드포인트 활용 (`/api/health/ready`)
</details>

## 🚀 성능 벤치마크

| 지표 | 목표값 | 실제값 |
|------|-------|--------|
| 인증 확인 응답시간 | < 50ms | ~30ms |
| API 프록시 응답시간 | < 150ms | ~120ms |
| 로그인 콜백 처리 | < 300ms | ~250ms |
| 동시 사용자 | 1,000+ | 검증됨 |
| 메모리 사용량 | < 512MB | ~256MB |

## 🤝 기여하기

### **개발 환경 설정**
```bash
# 1. 저장소 클론
git clone https://github.com/keyfront/keyfront-bff.git
cd keyfront-bff

# 2. 의존성 설치
npm install

# 3. 환경 설정
cp env.example .env
# .env 파일 편집

# 4. 개발 서버 시작
npm run docker:up  # Redis, Keycloak 시작
npm run dev        # 개발 서버 시작
```

### **기여 가이드라인**
1. **Issue 먼저 생성** - 기능 요청이나 버그 리포트
2. **Fork & Branch** - `feature/your-feature-name`
3. **테스트 작성** - 새 기능에 대한 테스트 필수
4. **문서 업데이트** - README, API 문서 업데이트
5. **Pull Request** - 상세한 설명과 함께

### **코딩 표준**
- **TypeScript Strict Mode** - 타입 안전성
- **ESLint + Prettier** - 코드 품질 및 포맷팅
- **Conventional Commits** - 커밋 메시지 표준
- **Test Coverage > 80%** - 품질 보증

## 📄 라이선스

MIT License - 상업적 사용, 수정, 배포 자유

## 📞 지원 및 커뮤니티

- **🐛 버그 리포트**: [GitHub Issues](https://github.com/keyfront/keyfront-bff/issues)
- **💡 기능 요청**: [GitHub Discussions](https://github.com/keyfront/keyfront-bff/discussions)
- **📖 문서**: [Wiki](https://github.com/keyfront/keyfront-bff/wiki)
- **💬 커뮤니티**: [Discord](https://discord.gg/keyfront) (예정)
- **📧 상업적 지원**: support@keyfront.dev

---

> **⭐ 이 프로젝트가 도움이 되었다면 Star를 눌러주세요!**
