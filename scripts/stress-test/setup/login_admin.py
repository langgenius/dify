#!/usr/bin/env python3

import sys
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent))

import base64
import json

import httpx
from common import Logger, config_helper


def encode_sensitive_field(value: str) -> str:
    """Encode fields the same way the web client does before login."""
    return base64.b64encode(value.encode("utf-8")).decode()


def login_admin() -> bool:
    """Login with admin account and save access token."""

    log = Logger("Login")
    log.header("Admin Login")

    # Read admin credentials from config
    admin_config = config_helper.read_config("admin_config")

    if not admin_config:
        log.error("Admin config not found")
        log.info("Please run setup_admin.py first to create the admin account")
        return False

    log.info(f"Logging in with email: {admin_config['email']}")

    # API login endpoint
    base_url = "http://localhost:5001"
    login_endpoint = f"{base_url}/console/api/login"

    # Prepare login payload
    login_payload = {
        "email": admin_config["email"],
        "password": encode_sensitive_field(admin_config["password"]),
        "remember_me": True,
    }

    try:
        # Make the login request
        with httpx.Client() as client:
            response = client.post(
                login_endpoint,
                json=login_payload,
                headers={"Content-Type": "application/json"},
            )

            if response.status_code == 200:
                log.success("Login successful!")

                response_data = response.json()

                # Check if login was successful
                if response_data.get("result") != "success":
                    log.error(f"Login failed: {response_data}")
                    return False

                access_token = response.cookies.get("access_token", "")
                refresh_token = response.cookies.get("refresh_token", "")
                csrf_token = response.cookies.get("csrf_token", "")

                if not access_token:
                    log.error("No access token found in response")
                    log.debug(f"Full response: {json.dumps(response_data, indent=2)}")
                    return False

                # Save token to config file
                token_config = {
                    "email": admin_config["email"],
                    "access_token": access_token,
                    "refresh_token": refresh_token,
                    "csrf_token": csrf_token,
                }

                # Save token config
                if config_helper.write_config("token_config", token_config):
                    log.info(f"Token saved to: {config_helper.get_config_path('benchmark_state')}")

                # Show truncated token for verification
                token_display = f"{access_token[:20]}..." if len(access_token) > 20 else "Token saved"
                log.key_value("Access token", token_display)
                return True

            elif response.status_code == 401:
                log.error("Login failed: Invalid credentials")
                log.debug(f"Response: {response.text}")
                return False
            else:
                log.error(f"Login failed with status code: {response.status_code}")
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
    if not login_admin():
        sys.exit(1)
