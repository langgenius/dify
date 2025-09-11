#!/usr/bin/env python3

import sys
import shutil
from pathlib import Path

from common import config_helper, Logger


def prepare_benchmark(config_type: str = "simple") -> None:
    """Prepare benchmark configuration with actual API token.

    Args:
        config_type: "simple" for single question, "varied" for multiple questions
    """

    log = Logger("PrepareBenchmark")
    log.header("Preparing Benchmark Configuration")

    # Check if drill is installed
    if not shutil.which("drill"):
        log.error("drill is not installed")
        log.info("Install drill with:")
        log.list_item("cargo install drill")
        log.info("Or download from: https://github.com/fcsonline/drill/releases")
        return

    # Read API token from config
    api_token = config_helper.get_api_key()
    if not api_token:
        log.error("No API token found in config")
        log.info("Please run the setup scripts first:")
        log.list_item("python scripts/benchmark/setup/setup_all.py")
        return

    log.key_value(
        "API Token", f"{api_token[:20]}..." if len(api_token) > 20 else "Found"
    )

    # Select config template based on type
    if config_type == "varied":
        drill_config_path = Path(__file__).parent / "drill_config_varied.yml"
        config_desc = "Multiple questions (5 different prompts)"
    else:
        drill_config_path = Path(__file__).parent / "drill_config.yml"
        config_desc = "Single question (repeated)"

    if not drill_config_path.exists():
        log.error(f"Drill config template not found: {drill_config_path}")
        return

    with open(drill_config_path, "r") as f:
        config_content = f.read()

    # Replace API token placeholder
    config_content = config_content.replace("{{ api_token }}", api_token)

    # Create benchmark config with actual token
    benchmark_config_path = Path(__file__).parent / "benchmark.yml"

    with open(benchmark_config_path, "w") as f:
        f.write(config_content)

    log.success(f"Benchmark config created: {benchmark_config_path}")

    log.separator()
    log.step("Benchmark Configuration:")
    log.key_value("Concurrency", "10 users")
    log.key_value("Iterations", "100 requests")
    log.key_value("Ramp-up", "5 seconds")
    log.key_value("Response mode", "blocking")
    log.key_value("Questions", config_desc)

    log.separator()
    log.info("To run the benchmark:")
    log.list_item(f"drill --benchmark {benchmark_config_path}")

    log.info("\nOr with statistics:")
    log.list_item(f"drill --benchmark {benchmark_config_path} --stats")

    log.info("\nOr with quiet mode (results only):")
    log.list_item(f"drill --benchmark {benchmark_config_path} --quiet")

    log.separator()
    log.warning("Make sure the following services are running:")
    log.list_item("Dify API server (port 5001)")
    log.list_item("Mock OpenAI server (port 5004)")


if __name__ == "__main__":
    import sys

    config_type = sys.argv[1] if len(sys.argv) > 1 else "simple"
    prepare_benchmark(config_type)
