# Backend architecture

The backend follows a strict domain-driven layering. Every use case lives in a slice: an application service owns the domain rules and declares the ports it needs, adapters implement those ports, one composition root wires them, and a thin controller admits and translates requests. The [API agent guide][api-guide] owns package facts, commands, and the condensed rules; this document owns the slice pattern and its review checks. `api/core/` is migration-only: never propose new files or extracted implementations there.

## Layers

Dependencies point toward the application layer. `api/.importlinter` enforces the `controllers -> services -> core -> libs` layering plus boundary contracts for each migrated slice, and `make lint` runs it.

| Layer | Location | Owns | Must not import |
| --- | --- | --- | --- |
| Transport | `controllers/` | Admission, payload validation, mapping to application inputs, error translation, response serialization | `models`, `repositories`, `sqlalchemy`, `extensions.ext_database`, legacy services a slice replaced |
| Application | Application modules in `services/<domain>/` | Use cases, invariants, domain values, ports, framework-neutral errors | `flask`, `werkzeug`, `sqlalchemy`, `models`, `repositories`, `controllers`, `extensions`, `configs`, `tasks` |
| Infrastructure | `repositories/` for persistence; `*_adapters.py` and `*_gateway.py` modules in `services/` for everything else | Port implementations over SQLAlchemy, Redis, Celery, Enterprise, plugins, `core`, and legacy services | `controllers` |
| Composition root | `extensions/ext_application_services.py` and `extensions/application_services/<domain>.py` | Choosing implementations, reading configuration, building services once per Flask app | `controllers` |
| Persistence model | `models/` | Table mappings | Application operations and session loading |

Application modules may import `machinery`, `enums`, business-agnostic `libs`, `graphon` values, and other slices' contracts and ports. Everything that touches a framework, the database, configuration, or a task queue is reached through a port. Services receive the framework-neutral `RequestContext`, `AccountRequestContext`, or `AppRequestContext` from `machinery.context`, never Flask's request or `current_user`.

## Reference slices

Model new work on these slices, not on legacy static services:

| Slice | Application | Persistence | Other adapters | Transport |
| --- | --- | --- | --- | --- |
| API-based extensions | `services/api_based_extension_application_service.py` | `repositories/api_based_extension_repository.py` | `services/api_based_extension_adapters.py` | `controllers/console/extension.py` |
| Workflow comments | `services/app/workflow_comment_service.py` | `repositories/app/workflow_comment_repository.py` | `services/app/workflow_comment_mention_gateway.py` | `controllers/console/app/workflow_comment.py` |
| App MCP server | `services/app/mcp_server_service.py` | `repositories/app/mcp_server_repository.py` | None | `controllers/console/app/mcp_server.py` |
| Conversation variables (read-only) | `services/conversation_variable_query.py` | `repositories/conversation_variable_query_repository.py` | None | `controllers/console/app/conversation_variables.py` |
| Workspace RBAC (multi-module domain) | `services/rbac/` | Existing workspace, app, and dataset repositories | `services/rbac/gateways.py` | `controllers/console/workspace/rbac/` |

Place new slices in their domain package (`services/app/`, `services/knowledge/`, `services/rbac/`, `services/workspace/`, `services/account/`) and mirror persistence in `repositories/<domain>/`.

## Application module

The module docstring states the boundary and its invariants. The module contains:

- **Values**: immutable records, `@dataclass(frozen=True, slots=True)` or `NamedTuple`. Name results `XRecord`, `XSummary`, or `XDetail` and inputs `XInput`, `XDraft`, `XUpdate`, or `XEdit`. Document what each `None` means. State the use case reasons about is an application-owned enum (`AppMCPServerStatus`).
- **Ports**: consumer-owned `typing.Protocol` classes named by role: `XStore` for persistence, `XQuery` for reads, `XGateway` for an external system or legacy service, or a capability name (`XNotifier`, `XEndpointProbe`, `XSecretCipher`). The port docstring is the adapter contract: owner scope, transaction boundary, and the slice errors the adapter raises.
- **Errors**: one `XError(Exception)` base with specific subclasses carrying user-facing messages. No HTTP status, Werkzeug exception, or response envelope.
- **Service**: a keyword-only constructor that takes ports and plain values (URLs, limits, flags, `now` callables). Each public method takes the admitted context first, reads scope from it (`active_workspace_id`, `account_id`), enforces invariants, calls ports with explicit owner ids, and returns records.

Larger domains split the module into `contracts.py` for shared values, `ports.py`, one module per use-case group, and `gateways.py` or `adapters.py`, as in `services/rbac/`, `services/workspace/`, and `services/account/`.

A read with no policy beyond owner scoping may skip the service. Declare the `XQuery` Protocol and its records in `services/`, implement it in `repositories/*_query_repository.py`, and expose the repository through a composition-root field typed as the Protocol (`conversation_variables: ConversationVariableQuery`). Introduce a service once the read gains rules.

## Adapters

- **Persistence**: `class XRepository(XStore)` in `repositories/<domain>/`, with `@override` on every port method and a `session_factory: sessionmaker[Session]` constructor argument. Each method opens its own session, using `with self._session_factory()` for reads and `with self._session_factory.begin()` for one bounded write transaction. It filters by the full owner chain, maps rows to records before the session closes, and raises the slice's errors. Sessions, ORM rows, and lazy relationships never cross the port. A repository imports only the application contracts it implements (values, ports, and errors), never other services; `knowledge-repository-boundary` enforces this for `repositories.knowledge`.
- **Runtime**: implement the remaining ports in `services/<domain>/<name>_adapters.py` or `<name>_gateway.py` over `core`, Celery tasks, Redis, Enterprise clients, or a legacy service. Adapters translate third-party failures into slice errors.
- **Reuse**: an existing repository may implement several consumer-owned ports. Extend it instead of adding parallel queries; see the [repositories rule][repositories].

## Composition root

Register the service on `ApplicationServices` in `extensions/ext_application_services.py`, or on a grouped frozen dataclass built in `extensions/application_services/<domain>.py` (`AppServices`, `RBACServices`, `KnowledgeServices`). Construct concrete adapters there, read `dify_config` there, and pass plain values in. Nothing else instantiates repositories or chooses implementations, and application services never build their own dependencies.

## Controller

1. Declare admission (`console_account_admission(...)`, `web_anonymous_admission`, and peers) with its role and RBAC checks. Admission injects the request context.
2. Validate the payload with Pydantic and map it into the slice's input record. Resolve transport conventions here, such as a masked secret the client echoes back.
3. Call `application_services().<slice>.<use_case>(request_context, ...)`.
4. Translate slice errors into `controllers.common.errors` or surface-specific `BaseHTTPException` subclasses, using a shared `_translate_errors()` context manager when several handlers need it. Preserve the existing status, `error_code`, and message.
5. Serialize records with `ResponseModel` and `dump_response`, following the [API schema guide][schema-guide].

## Boundary contracts

Each new or migrated slice adds its contracts to `api/.importlinter` in the same change:

```ini
[importlinter:contract:<slice>-service-boundary]
name = <Slice> application service is framework and persistence neutral
type = forbidden
source_modules =
    services.<domain>.<slice>_service
forbidden_modules =
    configs
    controllers
    extensions
    flask
    models
    repositories
    sqlalchemy
    tasks
    werkzeug

[importlinter:contract:console-<slice>-controller-boundary]
name = Console <slice> controller reaches persistence only through the composition root
type = forbidden
source_modules =
    controllers.console.<area>.<slice>
forbidden_modules =
    extensions.ext_database
    models
    repositories
    sqlalchemy
# The composition root wires repositories, so only direct imports are checked here.
allow_indirect_imports = True
```

The `ignore_imports` list of the `backend-layers` contract is an exact migration baseline. Never add an entry. Delete the entry for each import a migration removes, because unmatched ignores fail the lint.

## Domain rules

- Pass the owner ids each port call needs and filter every statement by the full owner chain (workspace, app, resource). Below the controller, never read the tenant or account from Flask globals.
- Close read sessions before external I/O, and materialize what that I/O needs first (`AppExportStore.load_export_data`).
- Dispatch side effects after the write commits. The write port returns what the effect needs, and the service triggers it (`WorkflowCommentWrite.mentions`).
- Keep ORM models as table mappings. Do not add session loading, caching, queries, or application operations to model classes. Keep slice-owned state columns primitive and map them in the repository.
- Do not raise HTTP errors or build responses below the controller.
- Reach another domain through its contract or port, never through its repository or legacy service internals.

## Migrating legacy code

Static services that use `db.session`, controllers that query models, and `core/` modules that call services are migration debt. When a change touches one:

- Move the touched use cases into a slice and delete the replaced service functions and their tests in the same change. Do not leave forwarding wrappers.
- Preserve the public contract: route, admission order, status codes, error codes and messages, and response fields. Comment deliberate legacy compatibility on the line that keeps it.
- Add the slice's boundary contracts and shrink `ignore_imports` where the migration removes an import.

## Tests

- **Application service**: in-memory port implementations (Protocol subclasses) that assert the owner scope of every call.
- **Repository**: `sqlite_session_factory` from `tests/unit_tests/conftest.py`; cover owner scoping, ordering, record mapping, and not-found errors.
- **Adapters**: the external call contract and failure translation.
- **Composition**: a wiring test in `tests/unit_tests/extensions/test_ext_application_services.py`.
- **Controller**: admission policy, payload mapping, error translation, and the wire contract.

CI rejects new `Mock`, `MagicMock`, and `SimpleNamespace` constructors (`scripts/check_no_new_test_doubles.py`). Use real objects or Protocol implementations.

## Business-agnostic libraries

`api/libs/` must not own product policy or orchestration. Flag service or controller dependencies and domain-specific decisions in library helpers. Move that behavior to its application owner outside `core/`, and keep only reusable infrastructure in `libs/`.

## Review checks

Flag each finding with the rule it violates:

- A controller that imports `models`, `repositories`, `sqlalchemy`, or `db`, queries tables, calls a legacy service a slice replaced, or decides business policy.
- An application module that imports a forbidden module, opens a session, reads `dify_config`, dispatches Celery tasks, or raises HTTP errors.
- A port that returns ORM rows or sessions, or an adapter method that misses an owner-chain predicate.
- Dependencies chosen outside the composition root, such as services constructing repositories or module-level service singletons.
- A new or migrated slice without boundary contracts, a weakened contract, or a new `ignore_imports` entry.
- Model classes gaining application behavior.
- New files or extracted implementations in `core/`, or product policy in `libs/`.
- Slice tests that replace ports with mock doubles, or repository behavior verified only through mocks.

[api-guide]: ../../../../api/AGENTS.md
[repositories]: repositories-rule.md
[schema-guide]: ../../../../api/controllers/API_SCHEMA_GUIDE.md
