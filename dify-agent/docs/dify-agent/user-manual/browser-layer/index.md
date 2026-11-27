# Browser module

`dify_agent.layers.browser.layer` declares Config, State and Capability. Config
carries the sub-agent budget (`max_steps`, `step_timeout_seconds`), navigation
policy (`use_vision`, `allowed_domains`, `block_ip_addresses`), `session_scope`,
`use_judge`, headless mode, and a `runtime` reference. Native ordering ensures
an active lease exists before the browser session starts.

The Capability exposes a single `browse_web` tool that delegates to a
browser-use sub-agent attaching over CDP to a headless Chromium hosted in the
active sandbox. Chromium binds its DevTools endpoint to loopback only, so the
launcher job also runs an in-job CDP forwarder that rewrites the remote Host
header DevTools rejects; it prints `CDP_READY` once the forwarder is up. State
is empty: the launcher job (Chromium plus forwarder) is (re)started per run with
a unique `$HOME/.browser` profile directory, so a resume simply relaunches it.
Exit cleanup deletes the launcher job and closes the harness before Runtime
releases the lease; the job teardown takes every Chromium child with it.

`persist_login_state` adds cross-run login persistence: before the harness
attaches, the previous run's cookies are restored into the browser over CDP,
and at run end the current cookie jar is dumped to a stable per-binding state
file in the sandbox home. `output_schema` (a JSON Schema) makes `browse_web`
return structured data, and `sensitive_data` passes login secrets to the
sub-agent without exposing them to the main model. Local runtimes cap
concurrent browser sessions per agent with
`browser_max_concurrent_sessions`; a saturated run fails fast instead of
queuing.

The sandbox image must ship Chromium, and the layer is injected only when the
deployment enables it and the Agent Soul enables `browser`.
