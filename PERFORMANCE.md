# Keyfront BFF - 공식 성능 기준 및 벤치마크

## 🎯 성능 목표 (ROADMAP 기준)

### 📊 **핵심 성능 지표**
| 메트릭 | 목표값 | 측정 방법 | 상태 |
|--------|--------|-----------|------|
| **인증 플로우** | p95 < 300ms | K6 부하 테스트 | 🔄 검증 필요 |
| **API 프록시** | p95 < 150ms | K6 부하 테스트 | 🔄 검증 필요 |
| **세션 검증** | p95 < 100ms | K6 부하 테스트 | 🔄 검증 필요 |
| **처리량** | > 1,000 RPS | K6 스트레스 테스트 | 🔄 검증 필요 |
| **동시 사용자** | 10,000+ | K6 소크 테스트 | 🔄 검증 필요 |
| **가용성** | 99.9% | 업타임 모니터링 | 🔄 검증 필요 |

### 🏗️ **시스템 리소스 목표**
| 리소스 | 목표값 | 측정 환경 | 상태 |
|--------|--------|-----------|------|
| **메모리 사용량** | < 512MB | 1,000 VU 부하 | 🔄 검증 필요 |
| **CPU 사용률** | < 70% | 정상 부하 | 🔄 검증 필요 |
| **응답 시간 변동성** | CV < 0.3 | 지속적 모니터링 | 🔄 검증 필요 |
| **에러율** | < 0.1% | 모든 테스트 | 🔄 검증 필요 |

## 🧪 벤치마크 테스트 시나리오

### 1. 📊 **인증 플로우 성능 테스트**

#### **테스트 목적**
OAuth2/OIDC 인증 프로세스의 전체 성능 측정

#### **측정 지표**
- Authorization Code + PKCE 플로우 응답시간
- 세션 생성 및 쿠키 설정 시간
- Keycloak 연동 지연시간
- 인증 실패 처리 시간

#### **성능 기준**
```
✅ p95 응답시간 < 300ms
✅ p99 응답시간 < 500ms  
✅ 성공률 > 99%
✅ 동시 인증 > 100 sessions/sec
```

#### **테스트 명령어**
```bash
# 인증 집중 테스트
npm run benchmark:auth
```

### 2. 🔗 **API 게이트웨이 성능 테스트**

#### **테스트 목적** 
다운스트림 API 프록시 성능 및 토큰 주입 오버헤드 측정

#### **측정 지표**
- 프록시 응답시간 (헤더 처리 포함)
- Bearer 토큰 주입 지연시간  
- 요청/응답 스트리밍 성능
- 에러 전파 시간

#### **성능 기준**
```
✅ p95 응답시간 < 150ms
✅ p99 응답시간 < 250ms
✅ 처리량 > 1,000 RPS
✅ 토큰 주입 오버헤드 < 5ms
```

#### **테스트 명령어**
```bash
# 게이트웨이 집중 테스트
npm run benchmark:gateway
```

### 3. 🔐 **세션 관리 성능 테스트**

#### **테스트 목적**
Redis 기반 세션 저장소 성능 및 확장성 검증

#### **측정 지표**
- 세션 검증 응답시간
- Redis 연결 풀 효율성
- 세션 만료 처리 시간
- 동시 세션 처리 능력

#### **성능 기준**
```
✅ p95 응답시간 < 100ms
✅ Redis 연결 < 10ms
✅ 동시 세션 > 5,000 sessions
✅ 세션 적중률 > 95%
```

#### **테스트 명령어**
```bash
# 세션 집중 테스트  
npm run benchmark:session
```

### 4. ⚡ **속도 제한 성능 테스트**

#### **테스트 목적**
Rate Limiting 정확성과 성능 영향도 측정

#### **측정 지표**
- 제한 검사 응답시간
- 카운터 증가 성능
- 429 응답 생성 시간
- 제한 정확성 (오차율)

#### **성능 기준**
```  
✅ 제한 검사 < 50ms
✅ 정확성 > 95%
✅ 429 응답 < 10ms
✅ 오차율 < 5%
```

#### **테스트 명령어**
```bash
# 속도 제한 테스트
npm run benchmark:ratelimit  
```

## 📈 성능 테스트 실행 가이드

### 🚀 **빠른 시작**

#### **1단계: 환경 준비**
```bash
# BFF 서버 시작
npm run dev

# 의존성 서비스 시작 (선택사항)
docker-compose up -d redis keycloak
```

#### **2단계: 기본 연결성 확인**
```bash
# 30초 간단 테스트 (5 VU)
npm run benchmark:smoke
```

#### **3단계: 부하 테스트 실행**
```bash
# 5분 일반 부하 (50 VU) 
npm run benchmark:load

# 10분 스트레스 테스트 (200 VU)
npm run benchmark:stress
```

### 🔧 **고급 설정**

#### **환경 변수 설정**
```bash
# 테스트 대상 URL
export BFF_BASE_URL="https://your-bff.com"

# 테스트 강도 설정  
export BENCHMARK_TYPE="load"        # smoke, load, stress, spike, soak
export BENCHMARK_DURATION="10m"     # 테스트 지속시간
export BENCHMARK_VUS="100"          # 가상 사용자 수
export BENCHMARK_RPS="500"          # 목표 RPS

# 완전한 테스트를 위한 설정
export KC_ISSUER_URL="https://keycloak.com/realms/test"
export REDIS_URL="redis://redis:6379"
```

#### **맞춤형 테스트 실행**
```bash
# 특정 시나리오만 실행
k6 run benchmarks/scripts/k6-load-test.js \
  --env BENCHMARK_TYPE=load \
  --env BFF_BASE_URL=http://localhost:3000 \
  --duration 5m \
  --vus 50

# 결과를 JSON으로 저장
k6 run benchmarks/scripts/k6-load-test.js \
  --out json=results/benchmark-$(date +%Y%m%d-%H%M).json
```

## 📊 성능 결과 분석

### 📁 **결과 파일 위치**
```
benchmarks/results/
├── performance-report.html      # HTML 대시보드
├── performance-summary.json     # JSON 상세 결과  
├── benchmark-20250126-1400.json # 타임스탬프별 결과
└── grafana-dashboard.json       # Grafana 대시보드 (선택)
```

### 📈 **주요 메트릭 해석**

#### **응답 시간 메트릭**
- **http_req_duration**: 전체 HTTP 요청 시간
- **http_req_waiting**: 서버 처리 시간 (네트워크 제외)
- **http_req_connecting**: 연결 설정 시간

#### **처리량 메트릭** 
- **http_reqs**: 초당 요청 수 (RPS)
- **data_received**: 초당 수신 바이트
- **data_sent**: 초당 송신 바이트

#### **사용자 정의 메트릭**
- **auth_success_rate**: 인증 성공률
- **auth_duration**: 인증 플로우 시간
- **session_validation_duration**: 세션 검증 시간
- **rate_limit_hits**: 속도 제한 발생 횟수

### 🚨 **성능 임계값 알람**

#### **경고 수준**
```javascript
⚠️  응답시간 p95 > 200ms
⚠️  에러율 > 0.5%  
⚠️  처리량 < 800 RPS
⚠️  메모리 사용량 > 400MB
```

#### **위험 수준**
```javascript
🚨 응답시간 p95 > 400ms
🚨 에러율 > 2%
🚨 처리량 < 500 RPS  
🚨 메모리 사용량 > 600MB
```

## 🎯 벤치마크 결과 목표값

### 🏆 **MVP 목표 (현재)**
- ✅ 기본 기능 동작 확인
- ✅ 안정성 검증 (에러율 < 1%)
- 🔄 성능 기준 달성 검증

### 🚀 **프로덕션 목표**
- 🎯 p95 응답시간 < 150ms (전체)
- 🎯 처리량 > 1,000 RPS
- 🎯 10,000+ 동시 사용자
- 🎯 99.9% 가용성

### 💎 **엔터프라이즈 목표**
- 🎖️ p95 응답시간 < 100ms
- 🎖️ 처리량 > 5,000 RPS  
- 🎖️ 100,000+ 동시 사용자
- 🎖️ 99.99% 가용성

## 🔄 성능 최적화 로드맵

### **Phase 1: 기준 측정** (현재)
- [x] 벤치마크 시스템 구축 ✅
- [ ] 기준 성능 측정 및 문서화
- [ ] 병목 지점 식별

### **Phase 2: 기본 최적화**
- [ ] 코드 레벨 최적화
- [ ] Redis 연결 풀 튜닝
- [ ] HTTP/2 및 압축 적용

### **Phase 3: 고급 최적화**  
- [ ] 캐싱 전략 구현
- [ ] 데이터베이스 인덱싱
- [ ] CDN 및 정적 자산 최적화

### **Phase 4: 확장성 최적화**
- [ ] 수평 확장 검증  
- [ ] 로드 밸런싱 최적화
- [ ] 마이크로서비스 분산

## 📞 성능 이슈 대응

### 🐛 **일반적인 성능 문제**

#### **느린 응답시간**
```bash
# 병목 지점 식별
npm run benchmark:diagnose

# 프로파일링 실행
NODE_ENV=production npm run dev --inspect
```

#### **높은 메모리 사용량**
```bash
# 메모리 리크 검사
npm run benchmark:memory

# 힙 덤프 생성
kill -USR2 <pid>
```

#### **Redis 연결 문제**
```bash
# Redis 성능 체크
redis-cli --latency-history

# 연결 풀 상태 확인
curl http://localhost:3000/api/health/ready
```

### 📞 **지원 및 문의**
- 📊 성능 이슈: [GitHub Issues](https://github.com/keyfront/issues)
- 📈 벤치마크 결과 공유: [Discussions](https://github.com/keyfront/discussions)
- 🔧 최적화 문의: keyfront-support@example.com

---

*마지막 업데이트: 2025-01-27*  
*버전: v1.0.0*  
*다음 검토: 성능 기준 달성 후*