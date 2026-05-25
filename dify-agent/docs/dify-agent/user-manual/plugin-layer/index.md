# Plugin layer

The plugin layer carries shared Dify plugin daemon context for a run. It
identifies the tenant and optional user context; server settings provide the
plugin daemon URL and API key.

Use it together with a [plugin LLM layer](../plugin-llm-layer/index.md) and,
when the caller wants Dify tools exposed to the model, a
[plugin tool layer](../plugin-tool-layer/index.md). Both business layers depend
on this layer to reach the plugin daemon.

## Config fields

| Field | Type | Meaning |
| --- | --- | --- |
| `tenant_id` | `str` | Dify tenant/workspace id used when calling the plugin daemon. |
| `user_id` | `str \| None` | Optional end-user id passed through to the plugin daemon. |

The plugin layer type id is `dify.plugin`.

## Basic usage

```python {test="skip" lint="skip"}
from dify_agent.layers.dify_plugin import DIFY_PLUGIN_LAYER_TYPE_ID, DifyPluginLayerConfig
from dify_agent.protocol import RunLayerSpec


plugin_layer = RunLayerSpec(
    name="plugin",
    type=DIFY_PLUGIN_LAYER_TYPE_ID,
    config=DifyPluginLayerConfig(
        tenant_id="replace-with-tenant-id",
        user_id="replace-with-user-id",
    ),
)
```

If you do not need a user id, omit `user_id` or pass `None`.

## Server-side settings

The plugin layer config does not include daemon transport settings. Configure
these on the Dify Agent server instead:

```env
DIFY_AGENT_PLUGIN_DAEMON_URL=http://localhost:5002
DIFY_AGENT_PLUGIN_DAEMON_API_KEY=replace-with-plugin-daemon-server-key
```

This keeps server credentials out of client-submitted layer config and out of
session snapshots.

## Notes

- The plugin layer does not open, cache, close, or snapshot HTTP clients.
- Concrete `plugin_id` values belong to the business layer that invokes the
  daemon: the plugin LLM layer for model calls and each plugin tool config for
  tool calls.
- The conventional layer name is `plugin`. If you use another name, point the
  LLM and tool layer dependencies at that name.
