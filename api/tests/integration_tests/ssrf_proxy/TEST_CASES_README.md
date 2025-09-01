# SSRF Proxy Test Cases

## Overview

The SSRF proxy test suite uses YAML files to define test cases, making them easier to maintain and extend without modifying code. These tests validate the SSRF proxy configuration in `docker/ssrf_proxy/`.

## Location

These tests are located in `api/tests/integration_tests/ssrf_proxy/` because they require the Python environment from the API project.

## Usage

### Basic Testing

From the `api/` directory:

```bash
uv run python tests/integration_tests/ssrf_proxy/test_ssrf_proxy.py
```

Or from the repository root:

```bash
cd api && uv run python tests/integration_tests/ssrf_proxy/test_ssrf_proxy.py
```

### List Available Tests

View all test cases without running them:

```bash
uv run python tests/integration_tests/ssrf_proxy/test_ssrf_proxy.py --list-tests
```

### Use Custom Test File

Run tests from a specific YAML file:

```bash
uv run python tests/integration_tests/ssrf_proxy/test_ssrf_proxy.py --test-file test_cases_extended.yaml
```

### Development Mode Testing

**WARNING: Development mode DISABLES all SSRF protections! Only use in development environments!**

Test the development mode configuration (used by docker-compose.middleware.yaml):

```bash
uv run python tests/integration_tests/ssrf_proxy/test_ssrf_proxy.py --dev-mode
```

Development mode:

- Mounts `conf.d.dev/` configuration that allows ALL requests
- Uses `test_cases_dev_mode.yaml` by default (all tests expect ALLOW)
- Verifies that private networks, cloud metadata, and non-standard ports are accessible
- Should NEVER be used in production environments

### Command Line Options

- `--host HOST`: Proxy host (default: localhost)
- `--port PORT`: Proxy port (default: 3128)
- `--no-container`: Don't start container (assume proxy is already running)
- `--save-results`: Save test results to JSON file
- `--test-file FILE`: Path to YAML file containing test cases
- `--list-tests`: List all test cases without running them
- `--dev-mode`: Run in development mode (DISABLES all SSRF protections - DO NOT use in production!)

## YAML Test Case Format

Test cases are organized by categories in YAML files:

```yaml
test_categories:
  category_key:
    name: "Category Display Name"
    description: "Category description"
    test_cases:
      - name: "Test Case Name"
        url: "http://example.com"
        expected_blocked: false  # true if should be blocked, false if allowed
        description: "Optional test description"
```

## Available Test Files

1. **test_cases.yaml** - Standard test suite with essential test cases (default)
1. **test_cases_extended.yaml** - Extended test suite with additional edge cases and scenarios
1. **test_cases_dev_mode.yaml** - Development mode test suite (all requests should be allowed)

All files are located in `api/tests/integration_tests/ssrf_proxy/`

## Categories

### Standard Categories

- **Private Networks**: Tests for blocking private IP ranges and loopback addresses
- **Cloud Metadata**: Tests for blocking cloud provider metadata endpoints
- **Public Internet**: Tests for allowing legitimate public internet access
- **Port Restrictions**: Tests for port-based access control

### Extended Categories (in test_cases_extended.yaml)

- **IPv6 Tests**: Tests for IPv6 address handling
- **Special Cases**: Edge cases like decimal/octal/hex IP notation

## Adding New Test Cases

1. Edit the YAML file (or create a new one)
1. Add test cases under appropriate categories
1. Run with `--test-file` option if using a custom file

Example:

```yaml
test_categories:
  custom_tests:
    name: "Custom Tests"
    description: "My custom test cases"
    test_cases:
      - name: "Custom Test 1"
        url: "http://test.example.com"
        expected_blocked: false
        description: "Testing custom domain"
```

## What Gets Tested

The tests validate the SSRF proxy configuration files in `docker/ssrf_proxy/`:

- `squid.conf.template` - Squid proxy configuration
- `docker-entrypoint.sh` - Container initialization script
- `conf.d/` - Additional configuration files (if present)
- `conf.d.dev/` - Development mode configuration (when using --dev-mode)

## Development Mode Configuration

Development mode provides a zero-configuration environment for local development:

- Mounts `conf.d.dev/` instead of `conf.d/`
- Allows ALL requests including private networks and cloud metadata
- Enables access to any port
- Disables all SSRF protections

### Using Development Mode with Docker Compose

From the main Dify repository root:

```bash
# Use the development overlay
docker-compose -f docker-compose.middleware.yaml -f docker/ssrf_proxy/docker-compose.dev.yaml up ssrf_proxy
```

Or manually mount the development configuration:

```bash
docker run -d \
  --name ssrf-proxy-dev \
  -p 3128:3128 \
  -v ./docker/ssrf_proxy/conf.d.dev:/etc/squid/conf.d:ro \
  # ... other volumes
  ubuntu/squid:latest
```

**CRITICAL**: Never use this configuration in production!

## Benefits

- **Maintainability**: Test cases can be updated without code changes
- **Extensibility**: Easy to add new test cases or categories
- **Clarity**: YAML format is human-readable and self-documenting
- **Flexibility**: Multiple test files for different scenarios
- **Fallback**: Code includes default test cases if YAML loading fails
- **Integration**: Properly integrated with the API project's Python environment
