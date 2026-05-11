#!/usr/bin/env bash
#
# Dify Node.js SDK Publish Script
# ================================
# A beautiful and reliable script to publish the SDK to npm
#
# Usage:
#   ./scripts/publish.sh            # Normal publish
#   ./scripts/publish.sh --dry-run  # Test without publishing
#   ./scripts/publish.sh --skip-tests  # Skip tests (not recommended)
#
# This script requires pnpm because the workspace uses catalog: dependencies.
#

set -euo pipefail

# ============================================================================
# Colors and Formatting
# ============================================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m' # No Color

# ============================================================================
# Helper Functions
# ============================================================================
print_banner() {
    echo -e "${CYAN}"
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║                                                               ║"
    echo "║           🚀 Dify Node.js SDK Publish Script 🚀              ║"
    echo "║                                                               ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

info() {
    echo -e "${BLUE}ℹ ${NC}$1"
}

success() {
    echo -e "${GREEN}✔ ${NC}$1"
}

warning() {
    echo -e "${YELLOW}⚠ ${NC}$1"
}

error() {
    echo -e "${RED}✖ ${NC}$1"
}

step() {
    echo -e "\n${MAGENTA}▶ ${BOLD}$1${NC}"
}

divider() {
    echo -e "${DIM}─────────────────────────────────────────────────────────────────${NC}"
}

run_npm() {
    env \
        -u npm_config_npm_globalconfig \
        -u NPM_CONFIG_NPM_GLOBALCONFIG \
        -u npm_config_verify_deps_before_run \
        -u NPM_CONFIG_VERIFY_DEPS_BEFORE_RUN \
        -u npm_config__jsr_registry \
        -u NPM_CONFIG__JSR_REGISTRY \
        -u npm_config_catalog \
        -u NPM_CONFIG_CATALOG \
        -u npm_config_overrides \
        -u NPM_CONFIG_OVERRIDES \
        npm "$@"
}

# ============================================================================
# Configuration
# ============================================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SCRIPT_DIR/../../.." && pwd))"

DRY_RUN=false
SKIP_TESTS=false

# Parse arguments
for arg in "$@"; do
    case $arg in
        --dry-run)
            DRY_RUN=true
            ;;
        --skip-tests)
            SKIP_TESTS=true
            ;;
        --help|-h)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --dry-run      Run without actually publishing"
            echo "  --skip-tests   Skip running tests (not recommended)"
            echo "  --help, -h     Show this help message"
            exit 0
            ;;
    esac
done

# ============================================================================
# Main Script
# ============================================================================
main() {
    print_banner
    cd "$PROJECT_DIR"

    # Show mode
    if [[ "$DRY_RUN" == true ]]; then
        warning "Running in DRY-RUN mode - no actual publish will occur"
        divider
    fi

    # ========================================================================
    # Step 1: Environment Check
    # ========================================================================
    step "Step 1/6: Checking environment..."
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        error "Node.js is not installed"
        exit 1
    fi
    NODE_VERSION=$(node -v)
    success "Node.js: $NODE_VERSION"

    # Check npm
    if ! command -v npm &> /dev/null; then
        error "npm is not installed"
        exit 1
    fi
    NPM_VERSION=$(run_npm -v)
    success "npm: v$NPM_VERSION"

    if ! command -v pnpm &> /dev/null; then
        error "pnpm is required because this workspace publishes catalog: dependencies"
        info "Install pnpm with Corepack: corepack enable"
        exit 1
    fi
    PNPM_VERSION=$(pnpm -v)
    success "pnpm: v$PNPM_VERSION"

    # Check npm login status
    if ! run_npm whoami &> /dev/null; then
        error "Not logged in to npm. Run 'npm login' first."
        exit 1
    fi
    NPM_USER=$(run_npm whoami)
    success "Logged in as: ${BOLD}$NPM_USER${NC}"

    # ========================================================================
    # Step 2: Read Package Info
    # ========================================================================
    step "Step 2/6: Reading package info..."
    
    PACKAGE_NAME=$(node -p "require('./package.json').name")
    PACKAGE_VERSION=$(node -p "require('./package.json').version")
    
    success "Package: ${BOLD}$PACKAGE_NAME${NC}"
    success "Version: ${BOLD}$PACKAGE_VERSION${NC}"

    # Check if version already exists on npm
    if run_npm view "$PACKAGE_NAME@$PACKAGE_VERSION" version &> /dev/null; then
        error "Version $PACKAGE_VERSION already exists on npm!"
        echo ""
        info "Current published versions:"
        run_npm view "$PACKAGE_NAME" versions --json 2>/dev/null | tail -5
        echo ""
        warning "Please update the version in package.json before publishing."
        exit 1
    fi
    success "Version $PACKAGE_VERSION is available"

    # ========================================================================
    # Step 3: Install Dependencies
    # ========================================================================
    step "Step 3/6: Installing dependencies..."
    
    pnpm --dir "$REPO_ROOT" install --frozen-lockfile 2>/dev/null || pnpm --dir "$REPO_ROOT" install
    success "Dependencies installed"

    # ========================================================================
    # Step 4: Run Tests
    # ========================================================================
    step "Step 4/6: Running tests..."
    
    if [[ "$SKIP_TESTS" == true ]]; then
        warning "Skipping tests (--skip-tests flag)"
    else
        pnpm test
        success "All tests passed"
    fi

    # ========================================================================
    # Step 5: Build
    # ========================================================================
    step "Step 5/6: Building package..."
    
    # Clean previous build
    rm -rf dist
    
    pnpm run build
    success "Build completed"

    # Verify build output
    if [[ ! -f "dist/index.js" ]]; then
        error "Build failed - dist/index.js not found"
        exit 1
    fi
    if [[ ! -f "dist/index.d.ts" ]]; then
        error "Build failed - dist/index.d.ts not found"
        exit 1
    fi
    success "Build output verified"

    # ========================================================================
    # Step 6: Publish
    # ========================================================================
    step "Step 6/6: Publishing to npm..."

    PACK_DIR="$(mktemp -d)"
    trap 'rm -rf "$PACK_DIR"' EXIT

    pnpm pack --pack-destination "$PACK_DIR" >/dev/null
    PACKAGE_TARBALL="$(find "$PACK_DIR" -maxdepth 1 -name '*.tgz' | head -n 1)"

    if [[ -z "$PACKAGE_TARBALL" ]]; then
        error "Pack failed - no tarball generated"
        exit 1
    fi

    if tar -xOf "$PACKAGE_TARBALL" package/package.json | grep -q '"catalog:'; then
        error "Packed manifest still contains catalog: references"
        exit 1
    fi

    divider
    echo -e "${CYAN}Package contents:${NC}"
    tar -tzf "$PACKAGE_TARBALL" | head -30
    divider

    if [[ "$DRY_RUN" == true ]]; then
        warning "DRY-RUN: Skipping actual publish"
        echo ""
        info "Packed artifact: $PACKAGE_TARBALL"
        info "To publish for real, run without --dry-run flag"
    else
        echo ""
        echo -e "${YELLOW}About to publish ${BOLD}$PACKAGE_NAME@$PACKAGE_VERSION${NC}${YELLOW} to npm${NC}"
        echo -e "${DIM}Press Enter to continue, or Ctrl+C to cancel...${NC}"
        read -r

        pnpm publish --access public --no-git-checks
        
        echo ""
        success "🎉 Successfully published ${BOLD}$PACKAGE_NAME@$PACKAGE_VERSION${NC} to npm!"
        echo ""
        echo -e "${GREEN}Install with:${NC}"
        echo -e "  ${CYAN}npm install $PACKAGE_NAME${NC}"
        echo -e "  ${CYAN}pnpm add $PACKAGE_NAME${NC}"
        echo -e "  ${CYAN}yarn add $PACKAGE_NAME${NC}"
        echo ""
        echo -e "${GREEN}View on npm:${NC}"
        echo -e "  ${CYAN}https://www.npmjs.com/package/$PACKAGE_NAME${NC}"
    fi

    divider
    echo -e "${GREEN}${BOLD}✨ All done!${NC}"
}

# Run main function
main "$@"
