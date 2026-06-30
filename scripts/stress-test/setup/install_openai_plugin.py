#!/usr/bin/env python3

import sys
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent))

import time

import httpx
from common import Logger, config_helper


def is_non_blocking_install_response(response_data: dict[str, object]) -> bool:
    return not response_data.get("code")


def install_openai_plugin() -> bool:
    """Install OpenAI plugin using saved access token."""

    log = Logger("InstallPlugin")
    log.header("Installing OpenAI Plugin")

    # Read token from config
    access_token = config_helper.get_token()
    if not access_token:
        log.error("No access token found in config")
        log.info("Please run login_admin.py first to get access token")
        return False

    log.step("Installing OpenAI plugin...")

    # API endpoint for plugin installation
    base_url = "http://localhost:5001"
    install_endpoint = f"{base_url}/console/api/workspaces/current/plugin/install/marketplace"

    # Plugin identifier
    plugin_payload = {
        "plugin_unique_identifiers": [
            "langgenius/openai:0.2.5@373362a028986aae53a7baf73a7f11991ba3c22c69eaf97d6cde048cfd4a9f98"
        ]
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
        # Make the installation request
        with httpx.Client() as client:
            response = client.post(
                install_endpoint,
                json=plugin_payload,
                headers=headers,
                cookies=cookies,
            )

            if response.status_code == 200:
                response_data = response.json()
                task_id = response_data.get("task_id")

                if not task_id:
                    if is_non_blocking_install_response(response_data):
                        log.warning("No installation task returned; plugin may already be installed")
                        log.debug(f"Response: {response.text}")
                        return True
                    log.error("No task ID received from installation request")
                    log.debug(f"Response: {response.text}")
                    return False

                log.progress(f"Installation task created: {task_id}")
                log.info("Polling for task completion...")

                # Poll for task completion
                task_endpoint = f"{base_url}/console/api/workspaces/current/plugin/tasks/{task_id}"

                max_attempts = 30  # 30 attempts with 2 second delay = 60 seconds max
                attempt = 0

                log.spinner_start("Installing plugin")

                while attempt < max_attempts:
                    attempt += 1
                    time.sleep(2)  # Wait 2 seconds between polls

                    task_response = client.get(
                        task_endpoint,
                        headers=headers,
                        cookies=cookies,
                    )

                    if task_response.status_code != 200:
                        log.spinner_stop(
                            success=False,
                            message=f"Failed to get task status: {task_response.status_code}",
                        )
                        return False

                    task_data = task_response.json()
                    task_info = task_data.get("task", {})
                    status = task_info.get("status")

                    if status == "success":
                        log.spinner_stop(success=True, message="Plugin installed!")
                        log.success("OpenAI plugin installed successfully!")

                        # Display plugin info
                        plugins = task_info.get("plugins", [])
                        if plugins:
                            plugin_info = plugins[0]
                            log.key_value("Plugin ID", plugin_info.get("plugin_id"))
                            log.key_value("Message", plugin_info.get("message"))
                        return True

                    elif status == "failed":
                        log.spinner_stop(success=False, message="Installation failed")
                        log.error("Plugin installation failed")
                        plugins = task_info.get("plugins", [])
                        if plugins:
                            for plugin in plugins:
                                log.list_item(f"{plugin.get('plugin_id')}: {plugin.get('message')}")
                        return False

                    # Continue polling if status is "pending" or other

                else:
                    log.spinner_stop(success=False, message="Installation timed out")
                    log.error("Installation timed out after 60 seconds")
                    return False

            elif response.status_code == 401:
                log.error("Installation failed: Unauthorized")
                log.info("Token may have expired. Please run login_admin.py again")
                return False
            elif response.status_code == 409:
                log.warning("Plugin may already be installed")
                log.debug(f"Response: {response.text}")
                return True
            else:
                log.error(f"Installation failed with status code: {response.status_code}")
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
    if not install_openai_plugin():
        sys.exit(1)
