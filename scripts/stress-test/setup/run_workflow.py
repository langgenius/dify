#!/usr/bin/env python3

import sys
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent))

import json

import httpx
from common import Logger, config_helper


def run_workflow(question: str = "fake question", streaming: bool = True) -> None:
    """Run the workflow app with a question."""

    log = Logger("RunWorkflow")
    log.header("Running Workflow")

    # Read API key from config
    api_token = config_helper.get_api_key()
    if not api_token:
        log.error("No API token found in config")
        log.info("Please run create_api_key.py first to create an API key")
        return

    log.key_value("Question", question)
    log.key_value("Mode", "Streaming" if streaming else "Blocking")
    log.separator()

    # API endpoint for running workflow
    base_url = "http://localhost:5001"
    run_endpoint = f"{base_url}/v1/workflows/run"

    # Run payload
    run_payload = {
        "inputs": {"question": question},
        "user": "default user",
        "response_mode": "streaming" if streaming else "blocking",
    }

    headers = {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "application/json",
    }

    try:
        # Make the run request
        with httpx.Client(timeout=30.0) as client:
            if streaming:
                # Handle streaming response
                with client.stream(
                    "POST",
                    run_endpoint,
                    json=run_payload,
                    headers=headers,
                ) as response:
                    if response.status_code == 200:
                        log.success("Workflow started successfully!")
                        log.separator()
                        log.step("Streaming response:")

                        for line in response.iter_lines():
                            if line.startswith("data: "):
                                data_str = line[6:]  # Remove "data: " prefix
                                if data_str == "[DONE]":
                                    log.success("Workflow completed!")
                                    break
                                try:
                                    data = json.loads(data_str)
                                    event = data.get("event")

                                    if event == "workflow_started":
                                        log.progress(f"Workflow started: {data.get('data', {}).get('id')}")
                                    elif event == "node_started":
                                        node_data = data.get("data", {})
                                        log.progress(
                                            f"Node started: {node_data.get('node_type')} - {node_data.get('title')}"
                                        )
                                    elif event == "node_finished":
                                        node_data = data.get("data", {})
                                        log.progress(
                                            f"Node finished: {node_data.get('node_type')} - {node_data.get('title')}"
                                        )

                                        # Print output if it's the LLM node
                                        outputs = node_data.get("outputs", {})
                                        if outputs.get("text"):
                                            log.separator()
                                            log.info("💬 LLM Response:")
                                            log.info(outputs.get("text"), indent=2)
                                            log.separator()

                                    elif event == "workflow_finished":
                                        workflow_data = data.get("data", {})
                                        outputs = workflow_data.get("outputs", {})
                                        if outputs.get("answer"):
                                            log.separator()
                                            log.info("📤 Final Answer:")
                                            log.info(outputs.get("answer"), indent=2)
                                        log.separator()
                                        log.key_value(
                                            "Total tokens",
                                            str(workflow_data.get("total_tokens", 0)),
                                        )
                                        log.key_value(
                                            "Total steps",
                                            str(workflow_data.get("total_steps", 0)),
                                        )

                                    elif event == "error":
                                        log.error(f"Error: {data.get('message')}")

                                except json.JSONDecodeError:
                                    # Some lines might not be JSON
                                    pass
                    else:
                        log.error(f"Workflow run failed with status code: {response.status_code}")
                        log.debug(f"Response: {response.text}")
            else:
                # Handle blocking response
                response = client.post(
                    run_endpoint,
                    json=run_payload,
                    headers=headers,
                )

                if response.status_code == 200:
                    log.success("Workflow completed successfully!")
                    response_data = response.json()

                    log.separator()
                    log.debug(f"Full response: {json.dumps(response_data, indent=2)}")

                    # Extract the answer if available
                    outputs = response_data.get("data", {}).get("outputs", {})
                    if outputs.get("answer"):
                        log.separator()
                        log.info("📤 Final Answer:")
                        log.info(outputs.get("answer"), indent=2)
                else:
                    log.error(f"Workflow run failed with status code: {response.status_code}")
                    log.debug(f"Response: {response.text}")

    except httpx.ConnectError:
        log.error("Could not connect to Dify API at http://localhost:5001")
        log.info("Make sure the API server is running with: ./dev/start-api")
    except httpx.TimeoutException:
        log.error("Request timed out")
    except Exception as e:
        log.error(f"An error occurred: {e}")


if __name__ == "__main__":
    # Allow passing question as command line argument
    if len(sys.argv) > 1:
        question = " ".join(sys.argv[1:])
    else:
        question = "What is the capital of France?"

    run_workflow(question=question, streaming=True)
