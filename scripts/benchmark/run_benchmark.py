#!/usr/bin/env python3

import sys
import subprocess
import socket
import shutil
from pathlib import Path
from datetime import datetime

from common import Logger


def check_service(host: str, port: int, service_name: str, log: Logger) -> bool:
    """Check if a service is running on the specified port."""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(2)
        result = sock.connect_ex((host, port))
        sock.close()

        if result == 0:
            log.success(f"{service_name} is running on port {port}")
            return True
        else:
            log.error(f"{service_name} is not accessible on port {port}")
            return False
    except Exception as e:
        log.error(f"Error checking {service_name}: {e}")
        return False


def run_benchmark(config_type: str = "simple") -> None:
    """Run the Dify workflow benchmark using drill.

    Args:
        config_type: "simple" for single question, "varied" for multiple questions
    """

    log = Logger("RunBenchmark")
    log.header("Dify Workflow Benchmark")

    # Check if drill is installed
    if not shutil.which("drill"):
        log.error("drill is not installed")
        log.info("Install drill with:")
        log.list_item("cargo install drill")
        log.info("Or download from: https://github.com/fcsonline/drill/releases")
        return

    # Check required services
    log.step("Checking required services...")
    log.separator()

    dify_running = check_service("localhost", 5001, "Dify API server", log)
    mock_running = check_service("localhost", 5004, "Mock OpenAI server", log)

    if not dify_running or not mock_running:
        log.separator()
        log.error("Required services are not running")
        log.info("Please start the following services:")
        if not dify_running:
            log.list_item("Dify API: ./dev/start-api")
        if not mock_running:
            log.list_item(
                "Mock OpenAI: python scripts/benchmark/setup/mock_openai_server.py"
            )
        return

    # Prepare benchmark config
    log.separator()
    log.step(f"Preparing benchmark configuration ({config_type})...")

    prepare_script = Path(__file__).parent / "prepare_benchmark.py"

    try:
        result = subprocess.run(
            [sys.executable, str(prepare_script), config_type],
            capture_output=True,
            text=True,
            check=False,
        )

        if result.returncode != 0:
            log.error("Failed to prepare benchmark configuration")
            if result.stderr:
                log.debug(result.stderr)
            return

    except Exception as e:
        log.error(f"Error preparing benchmark: {e}")
        return

    # Check if benchmark config was created
    benchmark_config = Path(__file__).parent / "benchmark.yml"

    if not benchmark_config.exists():
        log.error(f"Benchmark configuration not found: {benchmark_config}")
        return

    # Run benchmark
    log.separator()
    log.step("Starting benchmark...")
    log.info("This may take a while depending on the configuration...")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    report_file = Path(__file__).parent / f"benchmark_report_{timestamp}.txt"

    log.separator()
    log.key_value("Config", str(benchmark_config))
    log.key_value("Report", str(report_file))
    log.separator()

    try:
        # Run drill with stats
        log.spinner_start("Running benchmark")

        with open(report_file, "w") as report:
            # Write header
            report.write("Dify Workflow Benchmark Report\n")
            report.write(f"Generated: {datetime.now().isoformat()}\n")
            report.write("=" * 60 + "\n\n")

            # Run drill
            result = subprocess.run(
                ["drill", "--benchmark", str(benchmark_config), "--stats"],
                capture_output=True,
                text=True,
                check=False,
            )

            # Write output to report
            report.write("STDOUT:\n")
            report.write(result.stdout)
            report.write("\n\nSTDERR:\n")
            report.write(result.stderr)

        if result.returncode == 0:
            log.spinner_stop(success=True, message="Benchmark completed successfully!")

            # Parse and display key metrics
            output_lines = result.stdout.split("\n")

            log.separator()
            log.success("Benchmark Results")
            log.separator()

            # Display the output
            for line in output_lines:
                if line.strip():
                    log.info(line)

            log.separator()
            log.success(f"Full report saved to: {report_file}")

        else:
            log.spinner_stop(success=False, message="Benchmark failed")
            log.error(f"Drill exited with code: {result.returncode}")
            if result.stderr:
                log.debug(f"Error output:\n{result.stderr}")
            log.info(f"Check the report for details: {report_file}")

    except KeyboardInterrupt:
        log.spinner_stop(success=False, message="Benchmark interrupted")
        log.warning("Benchmark interrupted by user")

    except Exception as e:
        log.spinner_stop(success=False, message="Benchmark error")
        log.error(f"Error running benchmark: {e}")

    # Cleanup temporary benchmark.yml (keep the template)
    if benchmark_config.exists():
        try:
            benchmark_config.unlink()
            log.debug("Cleaned up temporary benchmark.yml")
        except Exception as e:
            log.error(f"Error cleaning up temporary benchmark.yml: {e}")


if __name__ == "__main__":
    import sys

    config_type = sys.argv[1] if len(sys.argv) > 1 else "simple"
    if config_type not in ["simple", "varied"]:
        print(f"Invalid config type: {config_type}. Use 'simple' or 'varied'")
        sys.exit(1)
    run_benchmark(config_type)
