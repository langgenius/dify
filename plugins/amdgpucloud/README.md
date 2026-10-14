# AMDGPUCloud

**Author: Letian Kang**  
**Contact: Letian.Kang@amd.com**

Native OpenAI-compatible model provider for AMD GPU Cloud / Token Factory.
This is an integration preview, managed through Dify's standard provider UI.

## Installation

1. Use self-hosted Dify 1.17.1 with the API compatibility setup below.
2. Install `AMDGPUCloud-0.0.9.difypkg` through **Integrations -> Install -> From Local File**.
3. Create your own `rc-*` key at [AMD GPU Cloud Model APIs](https://developer.amd.com.cn/radeon/modelapis).
4. Save it under **Model Provider -> AMDGPUCloud**, then select a model in Chat, Agent or Workflow.

The endpoint is fixed to `https://developer.amd.com.cn/radeon/api/v1`; custom
URLs are not accepted. Saving credentials sends a short `max_tokens=1`
validation request and can consume quota; `/models` alone cannot validate a key.
Use a test workspace. If local or unsigned packages are blocked, contact its
administrator rather than disabling production security checks.

### Self-hosted API compatibility

This provider does not install Dify, WSL or Docker. On a matching Dify 1.17.1
deployment, prepare a temporary input directory containing
[`prepare_overlay.py`](../../api-compat/prepare_overlay.py),
[`amdgpucloud_remote.py`](../../api-compat/amdgpucloud_remote.py) and the shared
[`model_catalog.py`](model_catalog.py). Run the generator in `langgenius/dify-api:1.17.1`
with `--payload /payload --output /output`, mounting that input read-only at
`/payload` and a dedicated output directory at `/output`. Use the image's
`/app/api/.venv/bin/python` entrypoint, host UID/GID, `--network none`, `--read-only`,
`--cap-drop ALL` and `--security-opt no-new-privileges`. It rejects a changed source
baseline without loading app configuration or credentials.

Copy the four generated files into the deployment's `docker/compat/`, and copy
[`compose.override.yaml`](../../api-compat/compose.override.yaml) alongside the
existing Compose files. Add the override to the existing Compose invocation;
preserve its project, environment, profiles and other overrides. Activating it
recreates only `api`, `api_websocket`, `worker` and `worker_beat`; generation itself
does not restart services. Do not apply it to another Dify version or replace the
deployment's private configuration. The Windows bootstrapper is a separate delivery,
not a dependency of this provider.

## Dynamic discovery and compatibility

Dify 1.17.1 / SDK 0.10.2 lacks the native remote model-list chain, so this build
requires the **read-only API overlay**, not just the plugin. It does not provide
dynamic listing on an unmodified Dify Cloud instance. The overlay reuses native
credentials, lists, selectors and parameters without changing the frontend or
daemon ABI. `predefined-model` enables the unified-key UI; its packaged list is empty.

There are no model YAMLs or fixed validation/fallback IDs. The public `/models`
catalog supplies IDs, capabilities, context, parameters and prices through the
shared parser. OCR/non-chat models are filtered by metadata. Refresh the native
list after the cache interval; service catalog changes require no plugin rebuild.
The memory cache lasts at most 30 seconds, isolated by credential digest and by
tenant/provider in the API adapter. Failed refreshes error rather than return
stale data. Generation rejects models absent from the current catalog.

Unpublished output maxima remain unspecified; default output budgets are client
settings, not service limits. Single tools, JSON Object and image support depend
on model metadata. Parallel tools, JSON Schema, embeddings and OCR are not declared.

## Identity and upgrades

Keep plugin ID **`amdgpucloud/amdgpucloud`** and canonical provider
`amdgpucloud/amdgpucloud/amdgpucloud` to preserve saved keys on same-ID upgrades.
Do not uninstall a configured provider to refresh its catalog. A publisher change
is a separate migration requiring credential/default/application dependency review;
catalog updates do not copy keys, rewrite applications or uninstall providers.

## Pricing, privacy and attribution

Dify displays ordinary input/output estimates, not cached-input discounts.
Token Factory account limits, usage and billing records are authoritative.
Requests use fixed `X-Source: dify` for aggregate attribution, without user,
workspace, application, conversation or request identifiers. Keys are obtained manually.
Prompt, image and tool data are sent to AMD; the plugin adds no persistent storage,
but the service may log requests. Read [PRIVACY.md](PRIVACY.md) before sending sensitive data.

## Development and acceptance

- Use Python 3.12: `uv sync --locked --group dev`, `uv run --locked pytest`,
  then `uv run --locked ruff check .`. Default tests do not call the public API.
- Opt-in live tests: `uv run python scripts/run_live_tests.py --key-file /path/to/private/rc-test-key`.
  Use only a dedicated `rc-*` key in an owned regular non-symlink file, mode `0600`
  or stricter. The launcher keeps it out of argv and suppresses sensitive diagnostics;
  do not use internal subscription keys or put keys in CI, logs or shell arguments.
- Remote debugging uses ignored `.env` configured from `.env.example` and
  `uv run python -m main`. Before distribution, run the official Marketplace
  validator and `scripts/check_package.py` on the built package.
- JSON/SSE responses require complete usage; streams are not automatically replayed.
  Redirects, malformed frames and missing `[DONE]` fail safely. The HTTP read timeout
  is 600 seconds; daemon/plugin deadlines must also allow long requests.

Previously verified locally: offline catalog, credential, wire/stream and package
safety checks, plus native provider listing. These are not business-inference passes.
Public-key Chat/Agent/Workflow, image/JSON/tool-round-trip acceptance and GPU-side
cancellation remain pending. Current limits/prices, Marketplace validation,
publisher ownership and brand approval must be checked before release.

## Source, support and licensing

Source: <https://github.com/JoursBleu/dify>. Report only sanitized errors and versions;
never include API keys or prompt content. Contact the author listed above.
[中文说明](readme/README_zh_Hans.md) · [Windows installation](readme/INSTALL_windows_zh_Hans.txt).

The [Dify Open Source License](../../LICENSE) and third-party notices remain applicable.
The local AMD GPU Cloud logo loads no remote image; source/checksum and trademark
boundaries are in [_assets/BRAND_ASSET_NOTICE.txt](_assets/BRAND_ASSET_NOTICE.txt).
`scripts/prepare_brand_icon.ps1` reproduces the icon from that pinned source.
This unsigned preview does not establish AMD/Dify approval or Marketplace publisher status.
