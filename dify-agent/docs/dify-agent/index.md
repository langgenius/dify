# Dify Agent runtime

Dify Agent hosts Agenton-composed Pydantic AI runs behind a FastAPI API. Its
source code stays under `src/dify_agent`, while framework-neutral Agenton code
stays under `src/agenton` and `src/agenton_collections`.

If a referenced Local Home Snapshot is missing from the sandbox filesystem,
creating a Binding starts with an empty Home and logs a warning. This does not
restore lost files or change how an existing Binding is acquired.

See the [operations guide](guide/index.md) for local server behavior.
