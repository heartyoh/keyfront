#!/bin/bash

echo "🚀 Keyfront BFF API 테스트 스크립트"
echo "=================================="

BASE_URL="http://localhost:3000"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_section() {
    echo -e "\n${BLUE}$1${NC}"
    echo "-----------------------------------"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

# Test function
test_endpoint() {
    local method=$1
    local endpoint=$2
    local description=$3
    local cookie_file=$4
    local data=$5
    
    echo -e "\n${YELLOW}테스트: $description${NC}"
    echo "요청: $method $endpoint"
    
    if [ -n "$cookie_file" ] && [ -f "$cookie_file" ]; then
        if [ -n "$data" ]; then
            response=$(curl -s -X $method \
                -H "Content-Type: application/json" \
                -b "$cookie_file" \
                -d "$data" \
                "$BASE_URL$endpoint")
        else
            response=$(curl -s -X $method \
                -b "$cookie_file" \
                "$BASE_URL$endpoint")
        fi
    else
        response=$(curl -s -X $method \
            -H "Content-Type: application/json" \
            "$BASE_URL$endpoint")
    fi
    
    echo "응답: $response"
    
    if echo "$response" | grep -q '"success":true'; then
        print_success "성공"
    else
        print_error "실패"
    fi
}

# Check if services are running
print_section "🔍 서비스 상태 확인"

# Check Redis
if redis-cli ping > /dev/null 2>&1; then
    print_success "Redis 연결됨"
else
    print_error "Redis 연결 실패 - docker-compose up -d 실행 필요"
fi

# Check Keycloak  
if curl -s http://localhost:8080/health/ready > /dev/null 2>&1; then
    print_success "Keycloak 준비됨"
else
    print_warning "Keycloak 시작 중... (1-2분 소요)"
fi

# Check Mock API
if curl -s http://localhost:4000/health > /dev/null 2>&1; then
    print_success "Mock API 준비됨"
else
    print_error "Mock API 연결 실패"
fi

print_section "📋 테스트 시나리오"

echo "1. 인증 없이 API 호출 (401 예상)"
test_endpoint "GET" "/api/me" "사용자 정보 조회 (인증 없음)"

echo -e "\n2. 게이트웨이 프록시 테스트 (401 예상)" 
test_endpoint "GET" "/api/gateway/api/users" "프록시를 통한 사용자 목록 조회"

print_section "🔗 수동 테스트 안내"

echo -e "${BLUE}브라우저 테스트:${NC}"
echo "1. 브라우저에서 http://localhost:3000/test 접속"
echo "2. 로그인 버튼 클릭 (Keycloak으로 리디렉션)"
echo "3. admin/admin으로 로그인"
echo "4. HTTP API 및 WebSocket 테스트 진행"

echo -e "\n${BLUE}curl을 이용한 인증 플로우:${NC}"
echo "1. 로그인 URL 가져오기:"
echo "   curl -v '$BASE_URL/api/auth/login'"
echo ""
echo "2. 브라우저에서 로그인 완료 후 세션 쿠키로 API 호출:"
echo "   curl -H 'Cookie: keyfront.sid=YOUR_SESSION_ID' '$BASE_URL/api/me'"

print_section "🐳 Docker 서비스 관리"

echo "서비스 시작: docker-compose up -d"
echo "로그 확인: docker-compose logs -f"
echo "서비스 중지: docker-compose down"

echo -e "\n${GREEN}테스트 완료!${NC}"