# Plugin layer

The plugin layer carries Dify plugin daemon identity for a run. It identifies the
tenant, plugin, and optional user context; server settings provide the plugin
daemon URL and API key.

Use it together with a [plugin LLM layer](../plugin-llm-layer/index.md). The LLM
layer depends on this layer to reach the plugin daemon.

## Config fields

| Field | Type | Meaning |
| --- | --- | --- |
| `tenant_id` | `str` | Dify tenant/workspace id used when calling the plugin daemon. |
| `plugin_id` | `str` | Plugin id, for example `langgenius/openai`. |
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
        plugin_id="langgenius/openai",
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
- `plugin_id` selects the plugin package. The business model provider and model
  name belong to the plugin LLM layer, not this layer.
- The conventional layer name is `plugin`. If you use another name, point the LLM
  layer dependency at that name.
