# Keyfront BFF - CI/CD 파이프라인 가이드

## 🚀 개요

Keyfront BFF는 **완전 자동화된 CI/CD 파이프라인**을 통해 코드 품질, 보안, 성능을 보장하며 프로덕션까지 안전하게 배포됩니다.

### 🎯 **CI/CD 목표**
- **품질 보장**: 80% 테스트 커버리지 + 엄격한 품질 게이트
- **보안 우선**: 다층 보안 스캔 + 취약점 자동 차단  
- **성능 검증**: 자동 성능 테스트 + 성능 임계값 검사
- **안전 배포**: 무중단 배포 + 자동 롤백 지원
- **가시성**: 실시간 대시보드 + 포괄적 모니터링

## 📋 파이프라인 구조

### 🔄 **워크플로 개요**

| 워크플로 | 트리거 | 목적 | 소요시간 |
|----------|--------|------|----------|
| **[ci.yml](.github/workflows/ci.yml)** | Push, PR | 지속적 통합 | ~15분 |
| **[release.yml](.github/workflows/release.yml)** | Tag, Release | 릴리스 배포 | ~25분 |
| **[security.yml](.github/workflows/security.yml)** | Schedule, Manual | 보안 스캔 | ~20분 |

---

## 🔧 CI 파이프라인 (ci.yml)

### **트리거 조건**
```yaml
on:
  push:
    branches: [ main, develop ]
  pull_request:  
    branches: [ main, develop ]
  workflow_dispatch:
    # 수동 실행 지원
```

### **단계별 작업**

#### 1️⃣ **코드 품질 검사** (`code-quality`)
- **ESLint**: 코드 스타일 및 품질 검사
- **TypeScript**: 타입 안정성 검증  
- **Security Audit**: `npm audit` 보안 취약점 검사
- **Super Linter**: 다중 언어 코드 품질 검증

#### 2️⃣ **단위 테스트** (`unit-tests`)
- **Redis 서비스**: 통합 테스트용 Redis 인스턴스
- **Jest 테스트**: 80% 커버리지 목표 달성
- **Coverage 리포트**: Codecov 통합 + PR 코멘트
- **JUnit 결과**: 테스트 결과 요약 대시보드

#### 3️⃣ **통합 테스트** (`integration-tests`)  
- **서비스 스택**: Redis + Keycloak 테스트 환경
- **애플리케이션 빌드**: 프로덕션 모드 빌드 검증
- **API 테스트**: `test-api.sh` 스크립트 실행
- **엔드투엔드**: 실제 사용 시나리오 검증

#### 4️⃣ **보안 스캔** (`security-scan`)
- **Trivy**: 파일시스템 취약점 스캔
- **OWASP**: 의존성 보안 검사
- **SARIF 업로드**: GitHub Security 탭 통합

#### 5️⃣ **Docker 빌드** (`docker-build`)  
- **멀티플랫폼**: AMD64 + ARM64 지원
- **보안 스캔**: 빌드된 이미지 취약점 검사
- **컨테이너 테스트**: 기본 헬스체크 실행
- **Registry 푸시**: GHCR.io 저장소 업로드

#### 6️⃣ **성능 테스트** (`performance-tests`)
- **K6 설치**: 성능 테스트 도구 설정
- **벤치마크 실행**: 종합 성능 검증 (`benchmark:suite`)
- **임계값 검사**: 성능 목표 달성 확인
- **리포트 생성**: HTML + JSON 성능 결과

#### 7️⃣ **배포** (`deploy`)
- **환경 선택**: Development/Staging/Production
- **Kubernetes**: Helm Chart 기반 배포
- **헬스체크**: 배포 후 상태 검증
- **알림**: 배포 성공/실패 통지

### **품질 게이트**
```yaml
# 필수 통과 조건
✅ 모든 테스트 통과 (단위 + 통합)
✅ 80% 이상 테스트 커버리지  
✅ ESLint + TypeScript 검사 통과
✅ 보안 스캔 통과 (Critical 취약점 0개)
✅ Docker 이미지 빌드 성공
✅ 성능 벤치마크 목표 달성
```

---

## 🏷️ 릴리스 파이프라인 (release.yml)

### **트리거 조건**  
```yaml
on:
  push:
    tags: [ 'v*' ]          # v1.0.0 형태 태그
  release:
    types: [created]         # GitHub Release 생성
  workflow_dispatch:
    # 수동 릴리스 지원
```

### **릴리스 단계**

#### 1️⃣ **릴리스 생성** (`create-release`)
- **태그 생성**: 버전 태그 자동 생성
- **체인지로그**: Git 커밋 기반 자동 생성  
- **GitHub Release**: 자동 릴리스 노트 생성

#### 2️⃣ **빌드 아티팩트** (`build-release`)
- **프로덕션 빌드**: 최적화된 Docker 이미지
- **멀티플랫폼**: AMD64 + ARM64 지원
- **SBOM 생성**: 소프트웨어 구성 요소 목록
- **Helm Chart**: Kubernetes 배포 패키지

#### 3️⃣ **성능 검증** (`performance-validation`)
- **릴리스 이미지**: 실제 배포 이미지로 성능 테스트
- **벤치마크 실행**: 종합 성능 검증
- **성능 게이트**: 임계값 미달 시 릴리스 차단

#### 4️⃣ **프로덕션 배포** (`deploy-production`)
- **Helm 배포**: 프로덕션 Kubernetes 클러스터
- **롤링 업데이트**: 무중단 배포  
- **헬스체크**: 배포 후 검증
- **자동 롤백**: 실패 시 이전 버전 복원

### **릴리스 전략**

| 브랜치/태그 | 환경 | 배포 방식 |
|-------------|------|-----------|
| `v*` (정식) | Production | 자동 배포 |
| `v*-rc*` (RC) | Staging | 자동 배포 |
| `v*-beta*` (Beta) | Staging | 자동 배포 |

---

## 🛡️ 보안 파이프라인 (security.yml)

### **트리거 조건**
```yaml  
on:
  push: [ main, develop ]     # 코드 변경 시
  pull_request: [ main ]      # PR 생성 시  
  schedule:                   # 매일 2AM UTC
    - cron: '0 2 * * *'
  workflow_dispatch:          # 수동 실행
```

### **보안 스캔 종류**

#### 1️⃣ **의존성 취약점** (`dependency-scan`)
- **NPM Audit**: Node.js 패키지 취약점
- **OWASP Dependency Check**: 알려진 취약점 데이터베이스  
- **Snyk**: 상용 취약점 스캐너
- **결과 분석**: Critical 취약점 발견 시 빌드 실패

#### 2️⃣ **코드 보안 분석** (`code-security-scan`)
- **CodeQL**: GitHub 고급 코드 분석
- **Semgrep**: 보안 패턴 매칭  
- **ESLint Security**: JavaScript/TypeScript 보안 규칙
- **SARIF 통합**: GitHub Security 탭 결과 표시

#### 3️⃣ **Docker 보안** (`docker-security-scan`)
- **Trivy**: 컨테이너 이미지 취약점
- **Hadolint**: Dockerfile 베스트 프랙티스
- **Docker Bench**: 컨테이너 런타임 보안
- **베이스 이미지**: Alpine Linux 보안 검증

#### 4️⃣ **시크릿 스캔** (`secret-scan`)  
- **TruffleHog**: Git 히스토리 시크릿 검색
- **GitLeaks**: 민감 정보 패턴 매칭
- **사용자 정의**: API 키, 암호 패턴 검색  
- **히스토리 분석**: 전체 Git 히스토리 스캔

#### 5️⃣ **인프라 보안** (`infrastructure-scan`)
- **Kubernetes 매니페스트**: Helm Chart 보안 검사  
- **Checkov**: IaC 보안 정책 검증
- **네트워크 정책**: 보안 격리 검증

### **보안 임계값**
```yaml
🚨 Critical: 즉시 빌드 실패
⚠️  High: 경고 (승인 필요)  
📊 Medium: 추적 및 모니터링
```

---

## ⚡ 성능 자동화

### **성능 테스트 트리거**
- **매 PR**: 성능 회귀 검증
- **릴리스 전**: 프로덕션 성능 확인
- **스케줄**: 주간 성능 트렌드 분석

### **성능 메트릭**  
```yaml
✅ p95 응답시간 < 300ms (인증)
✅ p95 응답시간 < 150ms (API 프록시)  
✅ 처리량 > 1,000 RPS
✅ 에러율 < 0.1%
✅ 메모리 사용량 < 512MB
```

### **성능 리포트**
- **HTML 대시보드**: 상세 성능 분석
- **PR 코멘트**: 성능 변화 요약  
- **트렌드 분석**: 시간별 성능 변화
- **임계값 알람**: 성능 저하 시 알림

---

## 🔄 브랜치 전략

### **Git Flow 기반**
```
main (프로덕션)
├── develop (개발)  
│   ├── feature/auth-improvement
│   ├── feature/performance-optimization
│   └── feature/security-enhancement
├── release/v1.2.0 (릴리스 준비)
└── hotfix/security-patch (긴급 수정)
```

### **자동화 규칙**
- **feature → develop**: PR 시 전체 CI 실행
- **develop → main**: 릴리스 준비 + 성능 검증  
- **main 태그**: 자동 프로덕션 배포
- **hotfix → main**: 긴급 패치 배포

---

## 📊 모니터링 & 가시성  

### **대시보드**
- **GitHub Actions**: 파이프라인 상태
- **Codecov**: 테스트 커버리지 트렌드  
- **Security**: 취약점 및 보안 알람
- **성능**: K6 벤치마크 결과

### **알림 시스템**
- **Slack**: 빌드 성공/실패 알림
- **Email**: 보안 취약점 발견 시  
- **GitHub**: PR 상태 체크
- **Discord**: 릴리스 완료 알림

### **메트릭 수집**
```yaml
📊 빌드 성공률: 95%+
⏱️ 평균 빌드 시간: 15분
🛡️ 보안 스캔 커버리지: 100%  
⚡ 성능 테스트 통과율: 98%+
```

---

## 🚀 사용 가이드

### **개발자 워크플로**

#### 1️⃣ **기능 개발**
```bash
# 1. 새 기능 브랜치 생성
git checkout -b feature/new-auth-method

# 2. 코드 작성 및 테스트
npm run dev
npm test  

# 3. 코드 품질 검사
npm run lint
npm run type-check

# 4. 커밋 및 푸시
git add .
git commit -m "feat: implement new authentication method"
git push origin feature/new-auth-method
```

#### 2️⃣ **Pull Request 생성**
```markdown  
## 🎯 변경 내용
- 새로운 인증 방식 구현
- OAuth 2.1 사양 준수  
- 보안 테스트 추가

## ✅ 체크리스트
- [x] 테스트 추가/수정
- [x] 문서 업데이트
- [x] 성능 영향 분석
- [x] 보안 검토 완료
```

#### 3️⃣ **CI 결과 확인**
- **코드 품질**: ✅ ESLint, TypeScript 통과
- **테스트**: ✅ 82% 커버리지 달성  
- **보안**: ✅ 취약점 없음
- **성능**: ✅ 벤치마크 통과

### **릴리스 프로세스**

#### 1️⃣ **릴리스 준비**
```bash
# 1. develop → main 머지
git checkout main
git merge develop

# 2. 버전 태그 생성
git tag -a v1.2.0 -m "Release v1.2.0"
git push origin v1.2.0
```

#### 2️⃣ **자동 릴리스**
- **빌드**: Docker 이미지 생성
- **테스트**: 성능 검증 실행  
- **배포**: Kubernetes 프로덕션 배포
- **검증**: 헬스체크 및 모니터링

#### 3️⃣ **배포 확인**
```bash
# Kubernetes 배포 상태 확인
kubectl rollout status deployment/keyfront-bff

# 헬스체크 확인  
curl https://keyfront-prod.example.com/api/health/live

# 성능 모니터링
npm run benchmark:smoke -- --env BFF_BASE_URL=https://keyfront-prod.example.com
```

### **긴급 패치 배포**

#### 1️⃣ **핫픽스 브랜치**
```bash
# main에서 핫픽스 브랜치 생성
git checkout -b hotfix/critical-security-fix main

# 패치 적용
# ... 코드 수정 ...

# 테스트 실행
npm test
npm run benchmark:smoke
```

#### 2️⃣ **긴급 배포**
```bash
# 핫픽스 태그 생성  
git tag -a v1.2.1 -m "Hotfix v1.2.1 - Critical security patch"
git push origin v1.2.1

# 자동 배포 실행 (5분 내)
# 모니터링 및 검증 (10분 내)
```

---

## 🔧 설정 및 시크릿

### **GitHub Secrets**
```yaml
# Container Registry
GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

# 보안 스캔 도구
SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
SEMGREP_APP_TOKEN: ${{ secrets.SEMGREP_APP_TOKEN }}

# 배포 환경
K8S_SERVER: ${{ secrets.K8S_SERVER }}  
K8S_TOKEN: ${{ secrets.K8S_TOKEN }}

# 알림
SLACK_WEBHOOK: ${{ secrets.SLACK_WEBHOOK }}
```

### **환경 설정**
```yaml
# Development Environment
- name: development
  url: https://keyfront-dev.example.com
  protection: false

# Staging Environment  
- name: staging
  url: https://keyfront-staging.example.com
  protection: true (승인 필요)

# Production Environment
- name: production  
  url: https://keyfront-prod.example.com
  protection: true (승인 + 스케줄 제한)
```

---

## 📈 성능 최적화

### **빌드 최적화**
- **병렬 실행**: 독립적 작업 동시 실행
- **캐시 활용**: Docker layer, npm 캐시
- **조건부 실행**: 변경된 컴포넌트만 테스트
- **아티팩트 재사용**: 빌드 결과물 공유

### **테스트 최적화**  
- **테스트 병렬화**: Jest worker 활용
- **스마트 실행**: 변경된 파일 기반 테스트
- **캐시 전략**: 테스트 결과 캐싱
- **가벼운 목킹**: 외부 의존성 최소화

---

## 🚨 문제 해결

### **일반적인 이슈**

#### ❌ **테스트 실패**
```yaml
문제: Jest 테스트 통과하지 못함
해결:
1. 로그 확인: GitHub Actions 테스트 로그 분석
2. 로컬 실행: npm test -- --verbose
3. 커버리지: 80% 이상 유지
4. Mock 검증: Redis, Keycloak 모킹 확인
```

#### ❌ **Docker 빌드 실패**  
```yaml
문제: 컨테이너 이미지 빌드 오류
해결:
1. Dockerfile 검증: 멀티스테이지 빌드 확인  
2. 캐시 정리: Docker buildx prune  
3. 플랫폼 확인: ARM64, AMD64 호환성
4. 베이스 이미지: Alpine Linux 버전 확인
```

#### ❌ **성능 테스트 실패**
```yaml  
문제: 벤치마크 임계값 미달
해결:
1. 로그 분석: K6 성능 결과 확인
2. 리소스 점검: CI 환경 리소스 제한
3. 임계값 조정: 성능 목표 재검토  
4. 로컬 테스트: npm run benchmark:smoke
```

#### ❌ **보안 스캔 실패**
```yaml
문제: 취약점 발견으로 빌드 차단  
해결:
1. 취약점 분석: SARIF 결과 검토
2. 패키지 업데이트: npm audit fix
3. 억압 규칙: 거짓 양성 필터링
4. 대안 검토: 안전한 패키지 대체
```

### **연락처**
- **기술 지원**: [GitHub Issues](https://github.com/keyfront/keyfront-bff/issues)
- **보안 이슈**: security@keyfront.com  
- **CI/CD 문의**: devops@keyfront.com

---

*마지막 업데이트: 2025-01-27*  
*버전: v1.0.0*  
*다음 검토: CI/CD 파이프라인 완성 후*