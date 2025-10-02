#!/usr/bin/env python3
"""
SSRF Proxy Test Suite

This script tests the SSRF proxy configuration to ensure it blocks
private networks while allowing public internet access.
"""

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from enum import Enum
from typing import final

import yaml


# Color codes for terminal output
class Colors:
    RED: str = "\033[0;31m"
    GREEN: str = "\033[0;32m"
    YELLOW: str = "\033[1;33m"
    BLUE: str = "\033[0;34m"
    NC: str = "\033[0m"  # No Color


class TestResult(Enum):
    PASSED = "passed"
    FAILED = "failed"
    SKIPPED = "skipped"


@dataclass
class TestCase:
    name: str
    url: str
    expected_blocked: bool
    category: str
    description: str = ""


@final
class SSRFProxyTester:
    def __init__(
        self,
        proxy_host: str = "localhost",
        proxy_port: int = 3128,
        test_file: str | None = None,
        dev_mode: bool = False,
    ):
        self.proxy_host = proxy_host
        self.proxy_port = proxy_port
        self.proxy_url = f"http://{proxy_host}:{proxy_port}"
        self.container_name = "ssrf-proxy-test-dev" if dev_mode else "ssrf-proxy-test"
        self.image = "ubuntu/squid:latest"
        self.results: list[dict[str, object]] = []
        self.dev_mode = dev_mode
        # Use dev mode test cases by default when in dev mode
        if dev_mode and test_file is None:
            self.test_file = "test_cases_dev_mode.yaml"
        else:
            self.test_file = test_file or "test_cases.yaml"

    def start_proxy_container(self) -> bool:
        """Start the SSRF proxy container"""
        mode_str = " (DEVELOPMENT MODE)" if self.dev_mode else ""
        print(f"{Colors.YELLOW}Starting SSRF proxy container{mode_str}...{Colors.NC}")
        if self.dev_mode:
            print(f"{Colors.RED}WARNING: Development mode DISABLES all SSRF protections!{Colors.NC}")

        # Stop and remove existing container if exists
        _ = subprocess.run(["docker", "stop", self.container_name], capture_output=True, text=True)
        _ = subprocess.run(["docker", "rm", self.container_name], capture_output=True, text=True)

        # Get directories for mounting config files
        script_dir = os.path.dirname(os.path.abspath(__file__))
        # Docker config files are in docker/ssrf_proxy relative to project root
        project_root = os.path.abspath(os.path.join(script_dir, "..", "..", "..", ".."))
        docker_config_dir = os.path.join(project_root, "docker", "ssrf_proxy")

        # Choose configuration template based on mode
        if self.dev_mode:
            config_template = "squid.conf.dev.template"
        else:
            config_template = "squid.conf.template"

        # Start container
        cmd = [
            "docker",
            "run",
            "-d",
            "--name",
            self.container_name,
            "-p",
            f"{self.proxy_port}:{self.proxy_port}",
            "-p",
            "8194:8194",
            "-v",
            f"{docker_config_dir}/{config_template}:/etc/squid/squid.conf.template:ro",
            "-v",
            f"{docker_config_dir}/docker-entrypoint.sh:/docker-entrypoint-mount.sh:ro",
            "-e",
            f"HTTP_PORT={self.proxy_port}",
            "-e",
            "COREDUMP_DIR=/var/spool/squid",
            "-e",
            "REVERSE_PROXY_PORT=8194",
            "-e",
            "SANDBOX_HOST=sandbox",
            "-e",
            "SANDBOX_PORT=8194",
            "--entrypoint",
            "sh",
            self.image,
            "-c",
            "cp /docker-entrypoint-mount.sh /docker-entrypoint.sh && sed -i 's/\\r$//' /docker-entrypoint.sh && chmod +x /docker-entrypoint.sh && /docker-entrypoint.sh",  # noqa: E501
        ]

        # Mount configuration directory (only in normal mode)
        # In dev mode, the dev template already allows everything
        if not self.dev_mode:
            # Normal mode: mount regular conf.d if it exists
            conf_d_path = f"{docker_config_dir}/conf.d"
            if os.path.exists(conf_d_path) and os.listdir(conf_d_path):
                cmd.insert(-3, "-v")
                cmd.insert(-3, f"{conf_d_path}:/etc/squid/conf.d:ro")
        else:
            print(f"{Colors.YELLOW}Using development mode configuration (all SSRF protections disabled){Colors.NC}")

        result = subprocess.run(cmd, capture_output=True, text=True)

        if result.returncode != 0:
            print(f"{Colors.RED}Failed to start container: {result.stderr}{Colors.NC}")
            return False

        # Wait for proxy to start
        print(f"{Colors.YELLOW}Waiting for proxy to start...{Colors.NC}")
        time.sleep(5)

        # Check if container is running
        result = subprocess.run(
            ["docker", "ps", "--filter", f"name={self.container_name}"],
            capture_output=True,
            text=True,
        )

        if self.container_name not in result.stdout:
            print(f"{Colors.RED}Container failed to start!{Colors.NC}")
            logs = subprocess.run(["docker", "logs", self.container_name], capture_output=True, text=True)
            print(logs.stdout)
            return False

        print(f"{Colors.GREEN}Proxy started successfully!{Colors.NC}\n")
        return True

    def stop_proxy_container(self):
        """Stop and remove the proxy container"""
        _ = subprocess.run(["docker", "stop", self.container_name], capture_output=True, text=True)
        _ = subprocess.run(["docker", "rm", self.container_name], capture_output=True, text=True)

    def test_url(self, test_case: TestCase) -> TestResult:
        """Test a single URL through the proxy"""
        # Configure proxy for urllib
        proxy_handler = urllib.request.ProxyHandler({"http": self.proxy_url, "https": self.proxy_url})
        opener = urllib.request.build_opener(proxy_handler)

        try:
            # Make request through proxy
            request = urllib.request.Request(test_case.url)
            with opener.open(request, timeout=5):
                # If we got a response, the request was allowed
                is_blocked = False

        except urllib.error.HTTPError as e:
            # HTTP errors like 403 from proxy mean blocked
            if e.code in [403, 407]:
                is_blocked = True
            else:
                # Other HTTP errors mean the request went through
                is_blocked = False
        except (urllib.error.URLError, OSError, TimeoutError) as e:
            # In dev mode, connection errors to 169.254.x.x addresses are expected
            # These addresses don't exist locally, so timeout is normal
            # The proxy allowed the request, but the destination is unreachable
            if self.dev_mode and "169.254" in test_case.url:
                # In dev mode, if we're testing 169.254.x.x addresses,
                # a timeout means the proxy allowed it (not blocked)
                is_blocked = False
            else:
                # In normal mode, or for other addresses, connection errors mean blocked
                is_blocked = True
        except Exception as e:
            # Unexpected error
            print(f"{Colors.YELLOW}Warning: Unexpected error testing {test_case.url}: {e}{Colors.NC}")
            return TestResult.SKIPPED

        # Check if result matches expectation
        if is_blocked == test_case.expected_blocked:
            return TestResult.PASSED
        else:
            return TestResult.FAILED

    def run_test(self, test_case: TestCase):
        """Run a single test and record result"""
        result = self.test_url(test_case)

        # Print result
        if result == TestResult.PASSED:
            symbol = f"{Colors.GREEN}✓{Colors.NC}"
        elif result == TestResult.FAILED:
            symbol = f"{Colors.RED}✗{Colors.NC}"
        else:
            symbol = f"{Colors.YELLOW}⊘{Colors.NC}"

        status = "blocked" if test_case.expected_blocked else "allowed"
        print(f"  {symbol} {test_case.name} (should be {status})")

        # Record result
        self.results.append(
            {
                "name": test_case.name,
                "category": test_case.category,
                "url": test_case.url,
                "expected_blocked": test_case.expected_blocked,
                "result": result.value,
                "description": test_case.description,
            }
        )

    def run_all_tests(self):
        """Run all test cases"""
        test_cases = self.get_test_cases()

        print("=" * 50)
        if self.dev_mode:
            print("    SSRF Proxy Test Suite (DEV MODE)")
            print("=" * 50)
            print(f"{Colors.RED}WARNING: Testing with SSRF protections DISABLED!{Colors.NC}")
            print(f"{Colors.YELLOW}All requests should be ALLOWED in dev mode.{Colors.NC}")
        else:
            print("         SSRF Proxy Test Suite")
        print("=" * 50)

        # Group tests by category
        categories: dict[str, list[TestCase]] = {}
        for test in test_cases:
            if test.category not in categories:
                categories[test.category] = []
            categories[test.category].append(test)

        # Run tests by category
        for category, tests in categories.items():
            print(f"\n{Colors.YELLOW}{category}:{Colors.NC}")
            for test in tests:
                self.run_test(test)

    def load_test_cases_from_yaml(self, yaml_file: str = "test_cases.yaml") -> list[TestCase]:
        """Load test cases from YAML configuration file"""
        try:
            # Try to load from YAML file
            yaml_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), yaml_file)

            with open(yaml_path) as f:
                config = yaml.safe_load(f)  # pyright: ignore[reportAny]

            test_cases: list[TestCase] = []

            # Parse test categories and cases from YAML
            test_categories = config.get("test_categories", {})  # pyright: ignore[reportAny]
            for category_key, category_data in test_categories.items():  # pyright: ignore[reportAny]
                category_name: str = str(category_data.get("name", category_key))  # pyright: ignore[reportAny]

                test_cases_list = category_data.get("test_cases", [])  # pyright: ignore[reportAny]
                for test_data in test_cases_list:  # pyright: ignore[reportAny]
                    test_case = TestCase(
                        name=str(test_data["name"]),  # pyright: ignore[reportAny]
                        url=str(test_data["url"]),  # pyright: ignore[reportAny]
                        expected_blocked=bool(test_data["expected_blocked"]),  # pyright: ignore[reportAny]
                        category=category_name,
                        description=str(test_data.get("description", "")),  # pyright: ignore[reportAny]
                    )
                    test_cases.append(test_case)

            if test_cases:
                print(f"{Colors.BLUE}Loaded {len(test_cases)} test cases from {yaml_file}{Colors.NC}")
                return test_cases
            else:
                print(f"{Colors.YELLOW}No test cases found in {yaml_file}, using defaults{Colors.NC}")
                return self.get_default_test_cases()

        except FileNotFoundError:
            print(f"{Colors.YELLOW}Test case file {yaml_file} not found, using defaults{Colors.NC}")
            return self.get_default_test_cases()
        except yaml.YAMLError as e:
            print(f"{Colors.YELLOW}Error parsing {yaml_file}: {e}, using defaults{Colors.NC}")
            return self.get_default_test_cases()
        except Exception as e:
            print(f"{Colors.YELLOW}Unexpected error loading {yaml_file}: {e}, using defaults{Colors.NC}")
            return self.get_default_test_cases()

    def get_default_test_cases(self) -> list[TestCase]:
        """Fallback test cases if YAML loading fails"""
        return [
            # Essential test cases as fallback
            TestCase("Loopback", "http://127.0.0.1", True, "Private Networks", "IPv4 loopback"),
            TestCase("Private Network", "http://192.168.1.1", True, "Private Networks", "RFC 1918"),
            TestCase("AWS Metadata", "http://169.254.169.254", True, "Cloud Metadata", "AWS metadata"),
            TestCase("Public Site", "http://example.com", False, "Public Internet", "Public website"),
            TestCase("Port 8080", "http://example.com:8080", True, "Port Restrictions", "Non-standard port"),
        ]

    def get_test_cases(self) -> list[TestCase]:
        """Get all test cases from YAML or defaults"""
        return self.load_test_cases_from_yaml(self.test_file)

    def print_summary(self):
        """Print test results summary"""
        passed = sum(1 for r in self.results if r["result"] == "passed")
        failed = sum(1 for r in self.results if r["result"] == "failed")
        skipped = sum(1 for r in self.results if r["result"] == "skipped")

        print("\n" + "=" * 50)
        print("           Test Summary")
        print("=" * 50)
        print(f"Tests Passed: {Colors.GREEN}{passed}{Colors.NC}")
        print(f"Tests Failed: {Colors.RED}{failed}{Colors.NC}")
        if skipped > 0:
            print(f"Tests Skipped: {Colors.YELLOW}{skipped}{Colors.NC}")

        if failed == 0:
            if hasattr(self, "dev_mode") and self.dev_mode:
                print(f"\n{Colors.GREEN}✓ All tests passed! Development mode is working correctly.{Colors.NC}")
                print(
                    f"{Colors.YELLOW}Remember: Dev mode DISABLES all SSRF protections - "
                    f"use only for development!{Colors.NC}"
                )
            else:
                print(f"\n{Colors.GREEN}✓ All tests passed! SSRF proxy is configured correctly.{Colors.NC}")
        else:
            if hasattr(self, "dev_mode") and self.dev_mode:
                print(f"\n{Colors.RED}✗ Some tests failed. Dev mode should allow ALL requests!{Colors.NC}")
            else:
                print(f"\n{Colors.RED}✗ Some tests failed. Please review the configuration.{Colors.NC}")
            print("\nFailed tests:")
            for r in self.results:
                if r["result"] == "failed":
                    status = "should be blocked" if r["expected_blocked"] else "should be allowed"
                    print(f"  - {r['name']} ({status}): {r['url']}")

        return failed == 0

    def save_results(self, filename: str = "test_results.json"):
        """Save test results to JSON file"""
        with open(filename, "w") as f:
            json.dump(
                {
                    "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "proxy_url": self.proxy_url,
                    "results": self.results,
                },
                f,
                indent=2,
            )
        print(f"\nResults saved to {filename}")


def main():
    @dataclass
    class Args:
        host: str = "localhost"
        port: int = 3128
        no_container: bool = False
        save_results: bool = False
        test_file: str | None = None
        list_tests: bool = False
        dev_mode: bool = False

    def parse_args() -> Args:
        parser = argparse.ArgumentParser(description="Test SSRF Proxy Configuration")
        _ = parser.add_argument("--host", type=str, default="localhost", help="Proxy host (default: localhost)")
        _ = parser.add_argument("--port", type=int, default=3128, help="Proxy port (default: 3128)")
        _ = parser.add_argument(
            "--no-container",
            action="store_true",
            help="Don't start container (assume proxy is already running)",
        )
        _ = parser.add_argument("--save-results", action="store_true", help="Save test results to JSON file")
        _ = parser.add_argument(
            "--test-file", type=str, help="Path to YAML file containing test cases (default: test_cases.yaml)"
        )
        _ = parser.add_argument("--list-tests", action="store_true", help="List all test cases without running them")
        _ = parser.add_argument(
            "--dev-mode",
            action="store_true",
            help="Run in development mode (DISABLES all SSRF protections - DO NOT use in production!)",
        )

        # Parse arguments - argparse.Namespace has Any-typed attributes
        # This is a known limitation of argparse in Python's type system
        namespace = parser.parse_args()

        # Convert namespace attributes to properly typed values
        # argparse guarantees these attributes exist with the correct types
        # based on our argument definitions, but the type system cannot verify this
        return Args(
            host=str(namespace.host),  # pyright: ignore[reportAny]
            port=int(namespace.port),  # pyright: ignore[reportAny]
            no_container=bool(namespace.no_container),  # pyright: ignore[reportAny]
            save_results=bool(namespace.save_results),  # pyright: ignore[reportAny]
            test_file=namespace.test_file or None,  # pyright: ignore[reportAny]
            list_tests=bool(namespace.list_tests),  # pyright: ignore[reportAny]
            dev_mode=bool(namespace.dev_mode),  # pyright: ignore[reportAny]
        )

    args = parse_args()

    tester = SSRFProxyTester(args.host, args.port, args.test_file, args.dev_mode)

    # If --list-tests flag is set, just list the tests and exit
    if args.list_tests:
        test_cases = tester.get_test_cases()
        mode_str = " (DEVELOPMENT MODE)" if args.dev_mode else ""
        print("\n" + "=" * 50)
        print(f"         Available Test Cases{mode_str}")
        print("=" * 50)
        if args.dev_mode:
            print(f"\n{Colors.RED}WARNING: Dev mode test cases expect ALL requests to be ALLOWED!{Colors.NC}")

        # Group by category for display
        categories: dict[str, list[TestCase]] = {}
        for test in test_cases:
            if test.category not in categories:
                categories[test.category] = []
            categories[test.category].append(test)

        for category, tests in categories.items():
            print(f"\n{Colors.YELLOW}{category}:{Colors.NC}")
            for test in tests:
                blocked_status = "BLOCK" if test.expected_blocked else "ALLOW"
                color = Colors.RED if test.expected_blocked else Colors.GREEN
                print(f"  {color}[{blocked_status}]{Colors.NC} {test.name}")
                if test.description:
                    print(f"        {test.description}")
                print(f"        URL: {test.url}")

        print(f"\nTotal: {len(test_cases)} test cases")
        sys.exit(0)

    try:
        # Start container unless --no-container flag is set
        if not args.no_container:
            if not tester.start_proxy_container():
                sys.exit(1)

        # Run tests
        tester.run_all_tests()

        # Print summary
        success = tester.print_summary()

        # Save results if requested
        if args.save_results:
            tester.save_results()

        # Exit with appropriate code
        sys.exit(0 if success else 1)

    finally:
        # Cleanup
        if not args.no_container:
            print(f"\n{Colors.YELLOW}Cleaning up...{Colors.NC}")
            tester.stop_proxy_container()


if __name__ == "__main__":
    main()
