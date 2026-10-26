# Shell module

`dify_agent.layers.shell.layer` declares Config, State and Capability. Config
contains CLI tools, environment values, secret names, redaction patterns and
`runtime` / optional `execution_context` references. Native ordering ensures an
active lease exists before shell bootstrap and config eager pulls.

The Capability exposes shell_run, shell_wait, shell_input and shell_interrupt
through a native sequential Toolset. JSON State holds initialized, job_ids and
job_offsets; live tokens remain in the run-scoped ShellSession. Bootstrap marks
initialized only on success. Exit cleanup removes tracked jobs and clears IDs,
offsets and credentials before Runtime releases the lease, including cancellation.
The API owns Workspace/Binding retirement. HOME is reusable system space; cwd
and TMPDIR/TMP/TEMP refer to the active Workspace.
