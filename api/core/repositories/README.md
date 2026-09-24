# Workflow node execution repository migration

Workflow node execution persistence now has two ports:

- `WorkflowNodeExecutionWriter` saves executions and offloaded data.
- `WorkflowNodeExecutionQuery` retrieves executions.

Use `DifyCoreRepositoryFactory.create_workflow_node_execution_repositories()`
when both ports belong to one run. Pass its `writer` and `query` to their respective
consumers. The factory shares pending Celery execution state between these ports.
Built-in writers receive an explicit `core.file.uploads.FileUploadWriter`.

Use `create_workflow_node_execution_query()` for independent reads. It does not
construct a built-in writer or require an upload service or Flask application context.

## Configuration compatibility

Existing `CORE_WORKFLOW_NODE_EXECUTION_REPOSITORY` values naming the old
SQLAlchemy, Celery or LogStore repository classes remain valid through the factory.
These names are aliases used to select the corresponding built-in reader and writer.

Independent configured backends implementing the combined
`WorkflowNodeExecutionRepository` protocol also remain supported. The factory calls
them with the original five keyword arguments: `session_factory`, `tenant_id`,
`user`, `app_id` and `triggered_from`. The same instance supplies both ports; no new
upload argument is passed to these backends.

## Python API changes

The old built-in class names are configuration aliases, not compatibility wrappers
for direct construction or inheritance. They now refer to write-only classes:
`get_by_workflow_execution()` and other read methods belong to the query classes.
Writers require `file_uploads`; the Celery writer also requires a shared `cache`.
The former `create_workflow_node_execution_repository()` factory method has been
replaced by the two methods above.

Custom code constructing or subclassing a built-in class must migrate explicitly.
Prefer composing a writer and a query repository and supplying the narrow ports to
callers. A configured custom backend can retain the original five-argument
constructor by implementing the combined protocol itself. Merely inheriting an old
built-in alias does not preserve that constructor or its former read methods.
