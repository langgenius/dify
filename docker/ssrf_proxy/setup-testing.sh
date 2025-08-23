#!/bin/bash
# Setup script for SSRF proxy in testing/CI environments
# This script creates the necessary configuration to allow sandbox access during tests

echo "Setting up SSRF proxy for testing environment..."

# Create conf.d directory if it doesn't exist
mkdir -p "$(dirname "$0")/conf.d"

# Copy testing configuration
cat > "$(dirname "$0")/conf.d/00-testing-environment.conf" << 'EOF'
# CI/Testing Environment Configuration
# This configuration is automatically generated for testing
# DO NOT USE IN PRODUCTION

# Allow access to sandbox service for integration tests
acl sandbox_service dst sandbox
http_access allow sandbox_service

# Allow access to Docker internal networks for testing
acl docker_internal dst 172.16.0.0/12
http_access allow docker_internal

# Allow localhost connections for testing
acl test_localhost dst 127.0.0.1 ::1
http_access allow test_localhost
EOF

echo "SSRF proxy testing configuration created successfully."