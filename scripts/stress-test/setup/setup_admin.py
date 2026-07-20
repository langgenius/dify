#!/usr/bin/env python3

import sys
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent))

import os

import httpx
from common import Logger, config_helper


def build_admin_config() -> dict[str, str]:
    return {
        "email": os.getenv("STRESS_TEST_ADMIN_EMAIL", "test@dify.ai"),
        "username": os.getenv("STRESS_TEST_ADMIN_USERNAME", "dify"),
        "password": os.getenv("STRESS_TEST_ADMIN_PASSWORD", "password123"),
    }


def setup_admin_account() -> bool:
    """Setup Dify API with an admin account."""

    log = Logger("SetupAdmin")
    log.header("Setting up Admin Account")

    admin_config = build_admin_config()

    # Save credentials to config file
    if config_helper.write_config("admin_config", admin_config):
        log.info(f"Admin credentials saved to: {config_helper.get_config_path('benchmark_state')}")

    # API setup endpoint
    base_url = "http://localhost:5001"
    setup_endpoint = f"{base_url}/console/api/setup"

    # Prepare setup payload
    setup_payload = {
        "email": admin_config["email"],
        "name": admin_config["username"],
        "password": admin_config["password"],
    }

    log.step("Configuring Dify with admin account...")

    try:
        # Make the setup request
        with httpx.Client() as client:
            response = client.post(
                setup_endpoint,
                json=setup_payload,
                headers={"Content-Type": "application/json"},
            )

            if response.status_code == 201:
                log.success("Admin account created successfully!")
                log.key_value("Email", admin_config["email"])
                log.key_value("Username", admin_config["username"])
                return True

            elif response.status_code in {400, 403}:
                log.warning("Setup may have already been completed")
                log.debug(f"Response: {response.text}")
                return True
            else:
                log.error(f"Setup failed with status code: {response.status_code}")
                log.debug(f"Response: {response.text}")
                return False

    except httpx.ConnectError:
        log.error("Could not connect to Dify API at http://localhost:5001")
        log.info("Make sure the API server is running with: ./dev/start-api")
        return False
    except Exception as e:
        log.error(f"An error occurred: {e}")
        return False


if __name__ == "__main__":
    if not setup_admin_account():
        sys.exit(1)
