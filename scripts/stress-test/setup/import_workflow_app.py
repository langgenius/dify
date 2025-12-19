#!/usr/bin/env python3

import sys
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent))

import json

import httpx
from common import Logger, config_helper  # type: ignore[import]


def import_workflow_app() -> None:
    """Import workflow app from DSL file and save app_id."""

    log = Logger("ImportApp")
    log.header("Importing Workflow Application")

    # Read token from config
    access_token = config_helper.get_token()
    if not access_token:
        log.error("No access token found in config")
        log.info("Please run login_admin.py first to get access token")
        return

    # Read workflow DSL file
    dsl_path = Path(__file__).parent / "dsl" / "workflow_llm.yml"

    if not dsl_path.exists():
        log.error(f"DSL file not found: {dsl_path}")
        return

    with open(dsl_path) as f:
        yaml_content = f.read()

    log.step("Importing workflow app from DSL...")
    log.key_value("DSL file", dsl_path.name)

    # API endpoint for app import
    base_url = "http://localhost:5001"
    import_endpoint = f"{base_url}/console/api/apps/imports"

    # Import payload
    import_payload = {"mode": "yaml-content", "yaml_content": yaml_content}

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
        "authorization": f"Bearer {access_token}",
        "content-type": "application/json",
        "sec-ch-ua": '"Not;A=Brand";v="99", "Google Chrome";v="139", "Chromium";v="139"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
    }

    cookies = {"locale": "en-US"}

    try:
        # Make the import request
        with httpx.Client() as client:
            response = client.post(
                import_endpoint,
                json=import_payload,
                headers=headers,
                cookies=cookies,
            )

            if response.status_code == 200:
                response_data = response.json()

                # Check import status
                if response_data.get("status") == "completed":
                    app_id = response_data.get("app_id")

                    if app_id:
                        log.success("Workflow app imported successfully!")
                        log.key_value("App ID", app_id)
                        log.key_value("App Mode", response_data.get("app_mode"))
                        log.key_value("DSL Version", response_data.get("imported_dsl_version"))

                        # Save app_id to config
                        app_config = {
                            "app_id": app_id,
                            "app_mode": response_data.get("app_mode"),
                            "app_name": "workflow_llm",
                            "dsl_version": response_data.get("imported_dsl_version"),
                        }

                        if config_helper.write_config("app_config", app_config):
                            log.info(f"App config saved to: {config_helper.get_config_path('benchmark_state')}")
                    else:
                        log.error("Import completed but no app_id received")
                        log.debug(f"Response: {json.dumps(response_data, indent=2)}")

                elif response_data.get("status") == "failed":
                    log.error("Import failed")
                    log.error(f"Error: {response_data.get('error')}")
                else:
                    log.warning(f"Import status: {response_data.get('status')}")
                    log.debug(f"Response: {json.dumps(response_data, indent=2)}")

            elif response.status_code == 401:
                log.error("Import failed: Unauthorized")
                log.info("Token may have expired. Please run login_admin.py again")
            else:
                log.error(f"Import failed with status code: {response.status_code}")
                log.debug(f"Response: {response.text}")

    except httpx.ConnectError:
        log.error("Could not connect to Dify API at http://localhost:5001")
        log.info("Make sure the API server is running with: ./dev/start-api")
    except Exception as e:
        log.error(f"An error occurred: {e}")


if __name__ == "__main__":
    import_workflow_app()
