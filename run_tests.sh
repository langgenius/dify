#!/bin/bash
set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

usage() {
    echo "Usage: $0 [backend|frontend|all]"
    echo ""
    echo "  backend   - Run backend unit tests (pytest)"
    echo "  frontend  - Run frontend unit tests (vitest)"
    echo "  all       - Run both (default)"
    exit 1
}

run_backend() {
    echo -e "${YELLOW}====== Backend Unit Tests ======${NC}"
    echo "Start: $(date '+%H:%M:%S')"

    uv run --project api pytest api/tests/unit_tests/ \
        -q \
        --timeout=30 \
        --tb=short \
        -p no:cacheprovider \
        "$@"

    local exit_code=$?
    echo "End: $(date '+%H:%M:%S')"

    if [ $exit_code -eq 0 ]; then
        echo -e "${GREEN}✓ Backend tests PASSED${NC}"
    else
        echo -e "${RED}✗ Backend tests FAILED (exit code: $exit_code)${NC}"
    fi
    return $exit_code
}

run_frontend() {
    echo -e "${YELLOW}====== Frontend Unit Tests ======${NC}"
    echo "Start: $(date '+%H:%M:%S')"

    cd "$ROOT_DIR/web"
    pnpm test -- --run "$@"

    local exit_code=$?
    cd "$ROOT_DIR"
    echo "End: $(date '+%H:%M:%S')"

    if [ $exit_code -eq 0 ]; then
        echo -e "${GREEN}✓ Frontend tests PASSED${NC}"
    else
        echo -e "${RED}✗ Frontend tests FAILED (exit code: $exit_code)${NC}"
    fi
    return $exit_code
}

TARGET="${1:-all}"
shift 2>/dev/null || true

case "$TARGET" in
    backend)
        run_backend "$@"
        ;;
    frontend)
        run_frontend "$@"
        ;;
    all)
        backend_ok=0
        frontend_ok=0

        run_backend "$@" || backend_ok=1
        echo ""
        run_frontend "$@" || frontend_ok=1

        echo ""
        echo -e "${YELLOW}====== Summary ======${NC}"
        [ $backend_ok -eq 0 ] && echo -e "  Backend:  ${GREEN}PASSED${NC}" || echo -e "  Backend:  ${RED}FAILED${NC}"
        [ $frontend_ok -eq 0 ] && echo -e "  Frontend: ${GREEN}PASSED${NC}" || echo -e "  Frontend: ${RED}FAILED${NC}"

        [ $backend_ok -eq 0 ] && [ $frontend_ok -eq 0 ] && exit 0 || exit 1
        ;;
    *)
        usage
        ;;
esac
