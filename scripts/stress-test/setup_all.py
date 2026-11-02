#!/usr/bin/env python3

import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
from common import Logger, ProgressLogger, config_helper


def build_admin_config() -> dict[str, str]:
    return {
        "email": os.getenv("STRESS_TEST_ADMIN_EMAIL", "test@dify.ai"),
        "username": os.getenv("STRESS_TEST_ADMIN_USERNAME", "dify"),
        "password": os.getenv("STRESS_TEST_ADMIN_PASSWORD", "password123"),
    }


def get_setup_step(base_url: str = "http://localhost:5001") -> str | None:
    try:
        response = httpx.get(f"{base_url}/console/api/setup", timeout=5)
        if response.status_code == 200:
            return response.json().get("step")
    except (httpx.HTTPError, ValueError):
        return None
    return None


def confirm(prompt: str) -> bool:
    answer = input(f"\n{prompt} [Y/n]: ").strip().lower()
    return answer in ("", "y", "yes")


def confirm_admin_credentials(log: Logger) -> bool:
    admin_config = build_admin_config()
    setup_step = get_setup_step()
    config_helper.write_config("admin_config", admin_config)

    if setup_step == "finished":
        log.warning("Dify is already initialized; setup will use the existing admin account to log in.")
        log.key_value("Admin email", admin_config["email"])
        log.info("Set STRESS_TEST_ADMIN_EMAIL and STRESS_TEST_ADMIN_PASSWORD if this is not the right account.")
        return confirm("Continue with this admin login?")

    log.info("Dify is not initialized; setup will create the first admin account with:")
    log.key_value("Admin email", admin_config["email"])
    log.key_value("Admin username", admin_config["username"])
    log.key_value("Admin password", admin_config["password"])
    log.info("Set STRESS_TEST_ADMIN_EMAIL, STRESS_TEST_ADMIN_USERNAME, or STRESS_TEST_ADMIN_PASSWORD to override.")
    return confirm("Create/use this admin account?")


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
        if confirm("Would you like to check again?"):
            return main()  # Recursively call main to check again
        else:
            print("❌ Setup cancelled. Please start the required services and try again.")
            sys.exit(1)

    log.success("All required services are running!")
    if not confirm_admin_credentials(log):
        print("❌ Setup cancelled. Please set the admin environment variables and try again.")
        sys.exit(1)

    # Define setup steps
    setup_step = get_setup_step()
    setup_steps = [
        ("login_admin.py", "Logging in and getting access token"),
        ("install_openai_plugin.py", "Installing OpenAI plugin"),
        ("configure_openai_plugin.py", "Configuring OpenAI plugin with mock server"),
        ("import_workflow_app.py", "Importing workflow application"),
        ("create_api_key.py", "Creating API key for the app"),
        ("publish_workflow.py", "Publishing the workflow"),
    ]
    if setup_step != "finished":
        setup_steps.insert(0, ("setup_admin.py", "Creating admin account"))

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
        if failed_step == "login_admin.py":
            if get_setup_step() == "finished":
                log.list_item(
                    "Dify is already initialized; set STRESS_TEST_ADMIN_EMAIL and "
                    "STRESS_TEST_ADMIN_PASSWORD to an existing admin account."
                )
            else:
                admin_config = build_admin_config()
                log.list_item(
                    "Dify is not initialized; setup creates the first admin with "
                    f"{admin_config['email']} / {admin_config['username']} unless overridden by environment variables."
                )
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
        if confirm("Would you like to run a test workflow now?"):
            log.step("Running test workflow...")
            run_script("run_workflow.py", "Testing workflow with default question")


if __name__ == "__main__":
    main()
