"""Synchronous Python client example for the Dify Agent run server.

Requires the same running FastAPI server as the async examples. ``create_run_sync``
does not retry ``POST /runs``; if a timeout occurs, inspect server state or create
a new run explicitly rather than assuming the original request was not accepted.
"""

from dify_agent.client import Client


API_BASE_URL = "http://localhost:8000"


def main() -> None:
    with Client(base_url=API_BASE_URL) as client:
        run = client.create_run_sync(
            {
                "compositor": {
                    "schema_version": 1,
                    "layers": [
                        {
                            "name": "prompt",
                            "type": "plain.prompt",
                            "config": {
                                "prefix": "You are a concise assistant.",
                                "user": "Say hello from the synchronous Dify Agent client example.",
                            },
                        }
                    ],
                },
                "agent_profile": {"provider": "test", "output_text": "Hello from the sync TestModel."},
            }
        )
        print("created run", run)
        terminal = client.wait_run_sync(run.run_id, poll_interval_seconds=0.5)
        print("terminal status", terminal)


if __name__ == "__main__":
    main()
