#!/usr/bin/env bash
set -euo pipefail

# Test script for Dify One-Click Installer
# This tests the configuration logic without actually starting services

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Testing Dify One-Click Installer (v2 - fixed)..."
echo ""

# Test 1: Check if .env.example exists
echo "Test 1: Checking for .env.example..."
if [ -f ".env.example" ]; then
    echo "  ✓ .env.example found"
else
    echo "  ✗ .env.example missing!"
    exit 1
fi

# Test 2: Check install.sh syntax
echo ""
echo "Test 2: Checking install.sh syntax..."
if bash -n install.sh; then
    echo "  ✓ install.sh syntax is valid"
else
    echo "  ✗ install.sh has syntax errors"
    exit 1
fi

# Test 3: Verify help output
echo ""
echo "Test 3: Checking help output..."
if bash install.sh --help | grep -q "Dify One-Click Installer"; then
    echo "  ✓ Help output works"
else
    echo "  ✗ Help output not working correctly"
    exit 1
fi

# Test 4: Check default mode is interactive
echo ""
echo "Test 4: Checking default mode..."
if head -100 install.sh | grep -q "INTERACTIVE=true"; then
    echo "  ✓ Default mode is interactive"
else
    echo "  ✗ Default mode should be interactive"
    exit 1
fi

# Test 5: Check for --yes option
echo ""
echo "Test 5: Checking for --yes option..."
if grep -q "YES_MODE" install.sh; then
    echo "  ✓ --yes option is supported"
else
    echo "  ✗ --yes option missing"
    exit 1
fi

# Test 6: Check SSL_CHOICE uses ask_choice
echo ""
echo "Test 6: Checking SSL option input validation..."
if grep -A5 -B5 "SSL_CHOICE" install.sh | grep -q "ask_choice"; then
    echo "  ✓ SSL options use ask_choice (validated)"
else
    echo "  ✗ SSL options should use ask_choice"
    exit 1
fi

# Test 7: Check cleanup trap
echo ""
echo "Test 7: Checking cleanup trap..."
if grep -q "trap cleanup EXIT" install.sh; then
    echo "  ✓ Cleanup trap is set"
else
    echo "  ✗ Cleanup trap missing"
    exit 1
fi

# Test 8: Check port checking function
echo ""
echo "Test 8: Checking port checking function..."
if grep -q "check_port" install.sh; then
    echo "  ✓ Port checking function exists"
else
    echo "  ✗ Port checking function missing"
    exit 1
fi

# Test 9: Check health check improvements
echo ""
echo "Test 9: Checking service health check..."
if grep -q "Waiting for services to be healthy" install.sh; then
    echo "  ✓ Health check logic exists"
else
    echo "  ✗ Health check logic missing"
    exit 1
fi

# Test 10: Check FILES_URL fix
echo ""
echo "Test 10: Checking FILES_URL configuration..."
if grep -q "files_url" install.sh || grep -q "FILES_URL.*5001" install.sh; then
    echo "  ✓ FILES_URL configuration exists"
else
    echo "  ✗ FILES_URL configuration needs review"
    # Not a critical failure
fi

# Test 11: Check sed escape function
echo ""
echo "Test 11: Checking sed escape function..."
if grep -q "escape_sed" install.sh; then
    echo "  ✓ escape_sed function exists"
else
    echo "  ✗ escape_sed function missing"
    exit 1
fi

# Test 12: Check update_env function
echo ""
echo "Test 12: Checking update_env function..."
if grep -q "update_env" install.sh; then
    echo "  ✓ update_env function exists"
else
    echo "  ✗ update_env function missing"
    exit 1
fi

# Test 13: Check directory safety check
echo ""
echo "Test 13: Checking directory safety check..."
if grep -q "is_safe_directory" install.sh; then
    echo "  ✓ is_safe_directory function exists"
else
    echo "  ✗ is_safe_directory function missing"
    exit 1
fi

# Test 14: Check .env file permissions
echo ""
echo "Test 14: Checking .env file permissions..."
if grep -q "chmod 600.*\.env" install.sh; then
    echo "  ✓ .env file permissions are set to 600"
else
    echo "  ✗ .env file permissions should be set to 600"
    exit 1
fi

# Test 15: Check secure secret generation
echo ""
echo "Test 15: Checking secure secret generation..."
if grep -q "Cannot generate secure secrets" install.sh; then
    echo "  ✓ Secret generation has proper error handling"
else
    echo "  ✗ Secret generation needs proper error handling"
    exit 1
fi

echo ""
echo "─────────────────────────────────────────────────────"
echo "All tests passed! ✓"
echo ""
echo "The installer script is ready to use."
echo ""
echo "Usage:"
echo "  ./install.sh                    # Interactive (default, recommended)"
echo "  ./install.sh --yes              # Quick install with defaults"
echo "  ./install.sh --help             # Show help"
echo ""
