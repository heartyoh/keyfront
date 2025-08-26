# Keyfront BFF Performance Benchmark System

## 개요

Keyfront BFF의 성능 테스트를 위한 K6 기반 벤치마크 시스템입니다. 
실제 프로덕션 환경에서의 성능 목표를 검증하고 병목 지점을 식별하기 위해 설계되었습니다.

## 성능 목표 (ROADMAP 기준)

- **인증**: p95 응답시간 < 300ms, 에러율 < 0.1%
- **API 프록시**: p95 응답시간 < 150ms, 에러율 < 0.1%  
- **세션 관리**: p95 응답시간 < 100ms
- **전체**: 99.9% 가용성

## 테스트 시나리오

### 1. 인증 플로우 테스트 (`testAuthenticationFlow`)
- OAuth2/OIDC 로그인 엔드포인트 테스트
- 미인증 요청 차단 검증
- Keycloak 연동 상태 확인

### 2. API 게이트웨이 테스트 (`testApiGatewayPerformance`)
- 프록시 엔드포인트 가용성 테스트
- 응답 시간 측정
- 게이트웨이 구현 상태 확인

### 3. 세션 관리 테스트 (`testSessionManagement`)
- 세션 검증 성능 측정
- Redis 연결 상태 확인
- 보호된 엔드포인트 접근 제어

### 4. 속도 제한 테스트 (`testRateLimitingSystem`)
- 속도 제한 정확성 검증
- 429 응답 및 헤더 확인
- 제한 해제 후 복구 테스트

## 벤치마크 유형

### Smoke Test
```bash
npm run benchmark:smoke
```
- 기간: 30초
- 가상 사용자: 5명
- 기본 기능 확인용

### Load Test  
```bash
npm run benchmark:load
```
- 기간: 5분
- 가상 사용자: 50명
- 일반적인 부하 테스트

### Stress Test
```bash
npm run benchmark:stress
```
- 기간: 10분
- 가상 사용자: 200명
- 고부하 상황 테스트

## 사전 요구사항

### 최소 요구사항 (현재 구현 상태)
- ✅ Keyfront BFF 서버 실행 (`npm run dev`)
- ✅ K6 설치 (`brew install k6`)

### 완전한 테스트를 위한 추가 요구사항
- ⚠️ Keycloak 서버 설정 및 실행
- ⚠️ Redis 서버 설정 및 실행  
- ⚠️ 테스트 사용자 계정 생성 (testuser0~99)
- ⚠️ 환경 변수 설정

## 환경 변수

```bash
# 벤치마크 설정
export BFF_BASE_URL="http://localhost:3000"
export BENCHMARK_TYPE="smoke"  # smoke, load, stress, spike, soak

# BFF 설정 (완전한 테스트용)
export KC_ISSUER_URL="https://keycloak.local/realms/aath"
export REDIS_URL="redis://localhost:6379"
```

## 결과 분석

### 메트릭 설명
- **auth_success_rate**: 인증 성공률
- **auth_duration**: 인증 플로우 소요 시간
- **api_gateway_duration**: API 게이트웨이 응답 시간
- **session_validation_duration**: 세션 검증 시간
- **rate_limit_hits**: 속도 제한 발동 횟수

### 결과 파일
- `benchmarks/results/performance-report.html`: HTML 리포트
- `benchmarks/results/performance-summary.json`: JSON 결과

## 현재 구현 상태

### ✅ 구현 완료
- K6 테스트 스크립트 구조
- 기본 연결성 테스트
- 단계별 테스트 시나리오
- 성능 메트릭 수집
- npm 스크립트 통합

### 🚧 개선 필요
- Keycloak 통합 테스트
- Redis 세션 테스트  
- 실제 API 게이트웨이 테스트
- 속도 제한 정확성 테스트

## 실행 예시

```bash
# 1. BFF 서버 시작
npm run dev

# 2. 기본 연결성 테스트
npm run benchmark:smoke

# 3. 부하 테스트 (의존성 준비 후)
npm run benchmark:load
```

## 문제 해결

### "BFF server is not reachable"
- `npm run dev`로 서버가 실행 중인지 확인
- `http://localhost:3000` 접근 가능한지 확인

### "Auth flow test incomplete"  
- Keycloak 서버 설정 필요
- KC_ISSUER_URL 환경변수 확인

### "Session test incomplete"
- Redis 서버 실행 확인
- REDIS_URL 환경변수 확인

---

*마지막 업데이트: 2024-12-25*