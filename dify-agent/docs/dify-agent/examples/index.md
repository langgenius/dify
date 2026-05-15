# Dify Agent examples

These examples live under `examples/dify_agent/dify_agent_examples`. They are
separated from Agenton examples because they depend on Dify Agent runtime services
such as the FastAPI server, Redis, or the plugin daemon.

## Run a Dify plugin-daemon backed model

```snippet {path="/examples/dify_agent/dify_agent_examples/run_pydantic_ai_agent.py"}
```

## Poll run events

```snippet {path="/examples/dify_agent/dify_agent_examples/run_server_consumer.py"}
```

## Use the synchronous client

```snippet {path="/examples/dify_agent/dify_agent_examples/run_server_sync_client.py"}
```

## Stream run events with SSE

```snippet {path="/examples/dify_agent/dify_agent_examples/run_server_sse_consumer.py"}
```
