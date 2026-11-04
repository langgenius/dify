# Get started

Create a run with `POST /runs`; poll `/runs/{run_id}` or consume its event stream.
The composition schema version is 2. Each entry contains a registered `name` and
current JSON `config`. Module identity comes from the server registry; there are
no graph type/dependency fields or generic per-module exit policy.

```json
{
  "composition": {
    "schema_version": 2,
    "layers": [
      {"name": "execution_context", "config": {"tenant_id": "tenant", "agent_mode": "agent_app", "invoke_from": "service-api"}},
      {"name": "prompt", "config": {"prefix": "Be helpful", "user": "Hello"}},
      {"name": "history", "config": {}},
      {"name": "llm", "config": {"execution_context": "execution_context", "plugin_id": "langgenius/openai", "model_provider": "openai", "model": "gpt-4o-mini"}}
    ]
  }
}
```

Resume by including the previous terminal `session_snapshot` and submitting the
current composition. `llm` is required, `history` and `output` are optional.
Resource cleanup always happens at exit. Cancellation is a separate operation;
its terminal event is published only after the owner run has cleaned up.
