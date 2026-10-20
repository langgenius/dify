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

Native Builder tests use the authenticated A7 scoped lease. Its supervisor owns
HOME/PATH/temp and rejects ambient environment or Agent Stub credentials; imports
require an explicit capability owner. Persisted `ShellJobRef` includes binding,
backend revision, workspace generation, job ID and output offset, with no token.

A native approval/configuration/interaction wait retains existing jobs under
the scope deadline. IDs/offsets remain in protected layer state before the
continuation owner commits its checkpoint and publishes waiting. Closing the
operation closes transports; reconnect inspects the same scope and sends stdin
to the saved job. A missing job, changed generation/revision/binding or different
returned job ID stops the native invocation without replaying its script.
Ordinary shell exit cleanup still deletes its tracked jobs. Terminal native
cleanup and API retirement remove the actual jobs/scope; failed scope cleanup
is quarantined for retry.
