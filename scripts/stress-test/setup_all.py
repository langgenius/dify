#!/usr/bin/env python3

import socket
import subprocess
import sys
import time
from pathlib import Path

from common import Logger, ProgressLogger


def run_script(script_name: str, description: str) -> bool:
    """Run a Python script and return success status."""
    script_path = Path(__file__).parent / "setup" / script_name

    if not script_path.exists():
        print(f"❌ Script not found: {script_path}")
        return False

    print(f"\n{'=' * 60}")
    print(f"🚀 {description}")
    print(f"   Running: {script_name}")
    print(f"{'=' * 60}")

    try:
        result = subprocess.run(
            [sys.executable, str(script_path)],
            capture_output=True,
            text=True,
            check=False,
        )

        # Print output
        if result.stdout:
            print(result.stdout)
        if result.stderr:
            print(result.stderr, file=sys.stderr)

        if result.returncode != 0:
            print(f"❌ Script failed with exit code: {result.returncode}")
            return False

        print(f"✅ {script_name} completed successfully")
        return True

    except Exception as e:
        print(f"❌ Error running {script_name}: {e}")
        return False


def check_port(host: str, port: int, service_name: str) -> bool:
    """Check if a service is running on the specified port."""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(2)
        result = sock.connect_ex((host, port))
        sock.close()

        if result == 0:
            Logger().success(f"{service_name} is running on port {port}")
            return True
        else:
            Logger().error(f"{service_name} is not accessible on port {port}")
            return False
    except Exception as e:
        Logger().error(f"Error checking {service_name}: {e}")
        return False


def main() -> None:
    """Run all setup scripts in order."""

    log = Logger("Setup")
    log.box("Dify Stress Test Setup - Full Installation")

    # Check if required services are running
    log.step("Checking required services...")
    log.separator()

    dify_running = check_port("localhost", 5001, "Dify API server")
    if not dify_running:
        log.info("To start Dify API server:")
        log.list_item("Run: ./dev/start-api")

    mock_running = check_port("localhost", 5004, "Mock OpenAI server")
    if not mock_running:
        log.info("To start Mock OpenAI server:")
        log.list_item("Run: python scripts/stress-test/setup/mock_openai_server.py")

    if not dify_running or not mock_running:
        print("\n⚠️  Both services must be running before proceeding.")
        retry = input("\nWould you like to check again? (yes/no): ")
        if retry.lower() in ["yes", "y"]:
            return main()  # Recursively call main to check again
        else:
            print("❌ Setup cancelled. Please start the required services and try again.")
            sys.exit(1)

    log.success("All required services are running!")
    input("\nPress Enter to continue with setup...")

    # Define setup steps
    setup_steps = [
        ("setup_admin.py", "Creating admin account"),
        ("login_admin.py", "Logging in and getting access token"),
        ("install_openai_plugin.py", "Installing OpenAI plugin"),
        ("configure_openai_plugin.py", "Configuring OpenAI plugin with mock server"),
        ("import_workflow_app.py", "Importing workflow application"),
        ("create_api_key.py", "Creating API key for the app"),
        ("publish_workflow.py", "Publishing the workflow"),
    ]

    # Create progress logger
    progress = ProgressLogger(len(setup_steps), log)
    failed_step = None

    for script, description in setup_steps:
        progress.next_step(description)
        success = run_script(script, description)

        if not success:
            failed_step = script
            break

        # Small delay between steps
        time.sleep(1)

    log.separator()

    if failed_step:
        log.error(f"Setup failed at: {failed_step}")
        log.separator()
        log.info("Troubleshooting:")
        log.list_item("Check if the Dify API server is running (./dev/start-api)")
        log.list_item("Check if the mock OpenAI server is running (port 5004)")
        log.list_item("Review the error messages above")
        log.list_item("Run cleanup.py and try again")
        sys.exit(1)
    else:
        progress.complete()
        log.separator()
        log.success("Setup completed successfully!")
        log.info("Next steps:")
        log.list_item("Test the workflow:")
        log.info(
            '   python scripts/stress-test/setup/run_workflow.py "Your question here"',
            indent=4,
        )
        log.list_item("To clean up and start over:")
        log.info("   python scripts/stress-test/cleanup.py", indent=4)

        # Optionally run a test
        log.separator()
        test_input = input("Would you like to run a test workflow now? (yes/no): ")

        if test_input.lower() in ["yes", "y"]:
            log.step("Running test workflow...")
            run_script("run_workflow.py", "Testing workflow with default question")


if __name__ == "__main__":
    main()
