#!/bin/bash

# Dify 企业 API 测试脚本

API_URL="${1:-http://127.0.0.1:5001}"
SECRET_KEY="${2:-your-secret-key-here}"

echo "================================================"
echo "🧪 Dify 企业 API 测试"
echo "================================================"
echo "API URL: $API_URL"
echo "Secret Key: ${SECRET_KEY:0:20}..."
echo "================================================"
echo ""

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 测试计数
PASSED=0
FAILED=0

# 测试函数
test_endpoint() {
    local name=$1
    local method=$2
    local endpoint=$3
    local data=$4

    echo -n "测试: $name ... "

    if [ "$method" == "GET" ]; then
        response=$(curl -s -w "\n%{http_code}" \
            -H "Enterprise-Api-Secret-Key: $SECRET_KEY" \
            "$API_URL$endpoint")
    else
        response=$(curl -s -w "\n%{http_code}" \
            -X "$method" \
            -H "Enterprise-Api-Secret-Key: $SECRET_KEY" \
            -H "Content-Type: application/json" \
            -d "$data" \
            "$API_URL$endpoint")
    fi

    http_code=$(echo "$response" | tail -n 1)
    body=$(echo "$response" | head -n -1)

    if [ "$http_code" -eq 200 ]; then
        echo -e "${GREEN}✅ PASS${NC}"
        PASSED=$((PASSED + 1))
        if command -v jq &> /dev/null; then
            echo "$body" | jq '.' 2>/dev/null | head -n 10
        else
            echo "$body" | head -c 200
        fi
    else
        echo -e "${RED}❌ FAIL (HTTP $http_code)${NC}"
        FAILED=$((FAILED + 1))
        echo "$body"
    fi
    echo ""
}

# 执行测试
echo "开始测试..."
echo ""

# 1. 系统配置
test_endpoint "获取企业配置" "GET" "/info"

# 2. 工作空间信息
test_endpoint "获取工作空间信息" "GET" "/workspace/test-tenant-123/info"

# 3. SSO 更新时间
test_endpoint "获取应用 SSO 更新时间" "GET" "/sso/app/last-update-time"
test_endpoint "获取工作空间 SSO 更新时间" "GET" "/sso/workspace/last-update-time"

# 4. Web 应用权限
test_endpoint "检查用户权限" "GET" "/webapp/permission?userId=user123&appId=app456"

test_endpoint "批量检查权限" "POST" "/webapp/permission/batch" \
    '{"userId":"user123","appIds":["app1","app2","app3"]}'

# 5. 访问模式
test_endpoint "获取应用访问模式" "GET" "/webapp/access-mode/id?appId=app123"

test_endpoint "批量获取访问模式" "POST" "/webapp/access-mode/batch/id" \
    '{"appIds":["app1","app2"]}'

test_endpoint "更新访问模式" "POST" "/webapp/access-mode" \
    '{"appId":"app123","accessMode":"private"}'

# 6. 清理操作
test_endpoint "清理 Web 应用" "DELETE" "/webapp/clean" \
    '{"appId":"app123"}'

# 测试总结
echo "================================================"
echo "📊 测试总结"
echo "================================================"
TOTAL=$((PASSED + FAILED))
echo "总测试数: $TOTAL"
echo -e "通过: ${GREEN}$PASSED${NC}"
echo -e "失败: ${RED}$FAILED${NC}"

if [ $FAILED -eq 0 ]; then
    echo -e "\n${GREEN}✨ 所有测试通过！${NC}"
    exit 0
else
    echo -e "\n${RED}⚠️  部分测试失败${NC}"
    exit 1
fi
