#!/usr/bin/env python3

import sys
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent))

import httpx
from common import Logger, config_helper


def configure_openai_plugin() -> bool:
    """Configure OpenAI plugin with mock server credentials."""

    log = Logger("ConfigPlugin")
    log.header("Configuring OpenAI Plugin")

    # Read token from config
    access_token = config_helper.get_token()
    if not access_token:
        log.error("No access token found in config")
        log.info("Please run login_admin.py first to get access token")
        return False

    log.step("Configuring OpenAI plugin with mock server...")

    # API endpoint for plugin configuration
    base_url = "http://localhost:5001"
    config_endpoint = f"{base_url}/console/api/workspaces/current/model-providers/langgenius/openai/openai/credentials"

    # Configuration payload with mock server
    config_payload = {
        "credentials": {
            "openai_api_key": "apikey",
            "openai_organization": None,
            "openai_api_base": "http://host.docker.internal:5004",
        }
    }

    headers = {
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "DNT": "1",
        "Origin": "http://localhost:3000",
        "Pragma": "no-cache",
        "Referer": "http://localhost:3000/",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-site",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
        **config_helper.console_auth_headers(),
        "content-type": "application/json",
        "sec-ch-ua": '"Not;A=Brand";v="99", "Google Chrome";v="139", "Chromium";v="139"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
    }

    cookies = config_helper.console_auth_cookies()

    try:
        # Make the configuration request
        with httpx.Client() as client:
            response = client.post(
                config_endpoint,
                json=config_payload,
                headers=headers,
                cookies=cookies,
            )

            if response.status_code == 200:
                log.success("OpenAI plugin configured successfully!")
                log.key_value("API Base", config_payload["credentials"]["openai_api_base"])
                log.key_value("API Key", config_payload["credentials"]["openai_api_key"])
                return True

            elif response.status_code == 201:
                log.success("OpenAI plugin credentials created successfully!")
                log.key_value("API Base", config_payload["credentials"]["openai_api_base"])
                log.key_value("API Key", config_payload["credentials"]["openai_api_key"])
                return True

            elif response.status_code == 401:
                log.error("Configuration failed: Unauthorized")
                log.info("Token may have expired. Please run login_admin.py again")
                return False
            else:
                log.error(f"Configuration failed with status code: {response.status_code}")
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
    if not configure_openai_plugin():
        sys.exit(1)
