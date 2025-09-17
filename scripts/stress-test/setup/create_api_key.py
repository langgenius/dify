#!/usr/bin/env python3

import sys
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent))

import json

import httpx
from common import Logger, config_helper


def create_api_key() -> None:
    """Create API key for the imported app."""

    log = Logger("CreateAPIKey")
    log.header("Creating API Key")

    # Read token from config
    access_token = config_helper.get_token()
    if not access_token:
        log.error("No access token found in config")
        return

    # Read app_id from config
    app_id = config_helper.get_app_id()
    if not app_id:
        log.error("No app_id found in config")
        log.info("Please run import_workflow_app.py first to import the app")
        return

    log.step(f"Creating API key for app: {app_id}")

    # API endpoint for creating API key
    base_url = "http://localhost:5001"
    api_key_endpoint = f"{base_url}/console/api/apps/{app_id}/api-keys"

    headers = {
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Content-Length": "0",
        "DNT": "1",
        "Origin": "http://localhost:3000",
        "Pragma": "no-cache",
        "Referer": "http://localhost:3000/",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-site",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
        "authorization": f"Bearer {access_token}",
        "content-type": "application/json",
        "sec-ch-ua": '"Not;A=Brand";v="99", "Google Chrome";v="139", "Chromium";v="139"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
    }

    cookies = {"locale": "en-US"}

    try:
        # Make the API key creation request
        with httpx.Client() as client:
            response = client.post(
                api_key_endpoint,
                headers=headers,
                cookies=cookies,
            )

            if response.status_code == 200 or response.status_code == 201:
                response_data = response.json()

                api_key_id = response_data.get("id")
                api_key_token = response_data.get("token")

                if api_key_token:
                    log.success("API key created successfully!")
                    log.key_value("Key ID", api_key_id)
                    log.key_value("Token", api_key_token)
                    log.key_value("Type", response_data.get("type"))

                    # Save API key to config
                    api_key_config = {
                        "id": api_key_id,
                        "token": api_key_token,
                        "type": response_data.get("type"),
                        "app_id": app_id,
                        "created_at": response_data.get("created_at"),
                    }

                    if config_helper.write_config("api_key_config", api_key_config):
                        log.info(f"API key saved to: {config_helper.get_config_path('benchmark_state')}")
                else:
                    log.error("No API token received")
                    log.debug(f"Response: {json.dumps(response_data, indent=2)}")

            elif response.status_code == 401:
                log.error("API key creation failed: Unauthorized")
                log.info("Token may have expired. Please run login_admin.py again")
            else:
                log.error(f"API key creation failed with status code: {response.status_code}")
                log.debug(f"Response: {response.text}")

    except httpx.ConnectError:
        log.error("Could not connect to Dify API at http://localhost:5001")
        log.info("Make sure the API server is running with: ./dev/start-api")
    except Exception as e:
        log.error(f"An error occurred: {e}")


if __name__ == "__main__":
    create_api_key()
