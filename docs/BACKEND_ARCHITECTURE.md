# Backend architecture

This guide helps backend contributors and reviewers decide where code belongs, who owns a business rule, and how dependencies fit together. Apply these boundaries to new and migrated code under `api/`; existing deviations are covered by [Migrating legacy code](#migrating-legacy-code).

The backend uses [ports and adapters](https://alistair.cockburn.us/hexagonal-architecture): application code defines the interfaces it needs (**ports**), and infrastructure implementations (**adapters**) supply those capabilities. A **composition root** constructs and connects them. This keeps use cases and business rules testable without running external systems.

Group related use cases, contracts, and domain behavior by business capability; this guide calls that group a **slice**. Use domain-driven design (DDD) concepts such as aggregates and domain services where business complexity warrants them.

Use the [repositories guide](BACKEND_REPOSITORIES.md) for repository reuse, the [SQLAlchemy guide](BACKEND_SQLALCHEMY.md) for database implementation patterns, the [schema guide](BACKEND_DATABASE_SCHEMA.md) for table design, and the [API schema guide](../api/controllers/API_SCHEMA_GUIDE.md) for request and response formats. Follow the backend developer guide's [testing guidelines](../api/README.md#testing).

## Responsibilities and code locations

The application and domain layers form the **application core**: the code that expresses use cases and business rules. This logical boundary is distinct from the legacy `api/core/` directory.

| Role | Responsibility | Location |
| --- | --- | --- |
| Transport | Check access, validate input, invoke a use case, and translate its result into the caller's protocol. | `api/controllers/` and task or command entry points |
| Application services | Coordinate use cases and declare the ports they need. | `api/services/`, grouped by business capability |
| Domain model | Own business state, rules, and state transitions. | `api/domain/<business_area>/` |
| Persistence adapters | Implement persistence and query ports; map records or aggregates to stored data. | `api/repositories/` |
| Other infrastructure adapters | Implement ports over external services, caches, queues, or legacy runtime code. | Existing adapter modules; retain their locations when reusing them |
| Composition root | Select implementations and wire service dependencies. | `api/extensions/ext_application_services.py` and `api/extensions/application_services/` |
| Persistence models | Map database tables and columns. | `api/models/` |
| Shared support | Provide framework-neutral identity types and utilities with no product-specific rules. | Support packages such as `api/machinery/context.py` and `api/libs/` |

Dependencies point toward the application core:

- Transport uses application contracts and obtains use cases from the composition root. It never queries persistence directly.
- Application services depend on domain behavior and their own ports, never on frameworks, persistence models, configuration modules, task queues, transport, or concrete adapters.
- Adapters depend on the contracts they implement. Repositories may also use domain types for mapping and business-rule evaluation, but never depend on application orchestration or transport.
- Domain code uses domain types, standard-library values, and helpers that preserve its [infrastructure independence](#domain-model-and-infrastructure-independence).

The composition root is wiring code at the application's outer boundary; it can reference the implementations it connects. Keep each slice's internals private: another slice reaches it through application contracts and ports, not through its repositories or domain internals. Shared utilities must not own business decisions or use-case orchestration.

## Application services

An application service implements a **use case**, such as creating a workflow comment. It receives ports and plain settings at construction. Each use case takes the caller identity and access scope as its first argument, obtains the required facts, invokes business behavior, performs effects through ports, and returns records. In slices without a domain model, business rules remain in application services until extracted; after extraction, the domain owns those rules.

Document the application's boundary and rules alongside its contracts:

- **Records** are immutable inputs and results. They carry data; a name ending in `Entity` does not make a record a DDD entity. Document what each optional field's absence means. Business state belongs to application contracts or domain objects, not solely to database models.
- **Ports** are interfaces defined by the application code that needs them, hence **consumer-owned ports**. Name them for their capability, such as persistence, querying, notification, or encryption. Query ports return records; persistence ports accept and return records or whole aggregates where a domain model exists. Document ownership scope, transaction boundaries, enforced rules, concurrency mechanisms, and errors so adapters can honor the same contract.
- **Errors** use one application error base per slice, with specific subtypes and user-facing messages. Translate domain failures when needed to preserve that contract. Domain errors belong to the domain package and never inherit from application errors. Neither carries protocol status codes or response shapes.

Split large slices into shared contracts, ports, and modules for related use cases. A read whose only rule is ownership scoping may use a query port implemented directly by a repository; wire that port through the composition root. This is still one use case from the handler's perspective. Add an application service when the read gains business rules.

## Domain model and infrastructure independence

The following terms follow [Eric Evans's DDD reference](https://www.domainlanguage.com/wp-content/uploads/2016/05/DDD_Reference_2015-03.pdf). An **invariant** is a business rule that must hold for every valid state.

- **Entity**: a business object whose identity persists as its state changes.
- **Value object**: a business value defined by its attributes, without independent identity. It can validate rules and provide behavior; an input or response record is not automatically a value object.
- **Aggregate**: a group consisting of a root entity and any child entities or value objects whose invariants must be maintained together. It defines a consistency boundary. A single entity can be an aggregate; do not copy every database relationship into it.
- **Aggregate root**: the entity through which callers change an aggregate. It controls changes to its children and protects aggregate-wide invariants. It owns business behavior; the composition root owns dependency wiring.

Domain methods may change an aggregate's in-memory state. **Infrastructure independence** means that domain behavior performs no external I/O and has no hidden infrastructure dependencies. Pass in facts such as the current time, generated identifiers, and membership or policy values. Given the same state and inputs, the business decision should be reproducible.

Domain code must not query or save data, manage sessions or transactions, read configuration, or use queues, notifications, caches, storage, or external APIs. Injecting a repository, notifier, callback, or event bus does not make those operations domain behavior. Application services obtain facts and arrange effects through ports; adapters perform the technical operations. This strict no-I/O boundary and application-owned ports are repository policies, not universal DDD requirements.

A domain operation may return a result or record a plain domain event describing a business fact. Recording an event in memory does not publish it or prove a successful database commit. Use an event only when it adds value; [delivery belongs outside the domain](#side-effects-and-delivery).

Keep an aggregate and its small child types together under its business-area package. This repository names aggregate roots `*Agg` and their modules `*_agg.py`; child entities use ordinary business names. These are naming conventions, not DDD terminology. Avoid global `aggregates/`, `entities/`, and `services/` directories that split one business model across the tree.

## Application services and domain services

A **domain service** expresses a business operation that does not naturally belong to an entity or value object. Keep a rule on its entity or aggregate when that is its natural owner. Coordinating repository calls or sending notifications is application work.

| Concern | Application service | Domain service |
| --- | --- | --- |
| Purpose | Coordinate a use case and its success or failure path. | Express a business calculation, decision, or policy. |
| Inputs | Caller identity, use-case inputs, and facts loaded through ports. | Domain objects and explicit facts supplied by the caller. |
| State | Coordinate progress; delegate business state to domain objects where present. | No independently persisted identity or lifecycle. |
| Effects | Load or save through ports and arrange delivery after commit. | Operate within the domain's infrastructure-independent boundary. |

A named function is sufficient for a small stateless policy; a service class or interface is not mandatory. Involving several objects does not by itself justify a domain service, and using one does not make writes to several aggregates atomic.

## Composition root

The [composition root](https://blog.ploeh.dk/2011/07/28/CompositionRoot/) is the application's dependency-wiring boundary near startup. It is one logical boundary, implemented by the extension and builder modules listed above, rather than a requirement to put all construction in one file.

Register application services there, grouped by business area. Construct their concrete adapters, read the configuration they need, and pass plain values into services. Application services never construct their own infrastructure dependencies. Keep production repository construction and module-level application-service instances in this wiring boundary; tests may construct services directly with test dependencies.

Domain objects can be constructed during a use case or reconstructed by a repository. Domain objects and functions need no service registration.

## Transport and ownership

**Admission** means the entry-point checks that establish who the caller is and what they may access, including role, permission, and supported anonymous-access checks. Pass that identity and scope as framework-neutral values, such as [`RequestContext`](../api/machinery/context.py). Below transport, never obtain the tenant or account from framework globals.

A handler performs these steps:

1. Apply admission checks in the required order.
2. Validate input and translate protocol conventions into application inputs.
3. Call one use case obtained from the composition root, including the simple query-port case described above.
4. Translate application errors into protocol errors while preserving status codes, error codes, and messages.
5. Serialize results using the [API schema guide](../api/controllers/API_SCHEMA_GUIDE.md).

Transport owns protocol handling; application and domain code own business decisions.

An **ownership chain** identifies the parents that scope a resource, for example workspace → app → comment → reply. Derive permitted scope from the trusted caller context and pass the applicable owner identifiers explicitly to every port operation that accesses owned data. Repositories enforce all relevant ownership relationships on reads and writes, including validating parent ownership on insertion. A resource ID alone is insufficient to establish access.

Document explicitly when a port accesses global data with no tenant owner, as allowed by the [schema guide](BACKEND_DATABASE_SCHEMA.md#prefer-including-tenant_id-in-model-definitions). A capability operating only on already-prepared values, such as sending prepared notifications, need not accept unrelated owner identifiers. These cases do not remove the entry point's access checks.

## Persistence and other adapters

Repositories implement persistence and query ports. Convert stored data to application records or domain aggregates before the session closes; sessions, persistence models, and lazy relationships must not cross a port. Map application- or domain-owned state to database columns when saving.

A repository may enforce a business rule when it must hold atomically with a write. For a rule already extracted into the domain, call that domain behavior inside the transaction rather than copying it into the adapter. The port must document the rule and its concurrency protection. Reuse existing repositories and allow one implementation to satisfy several consumer ports; see the [repositories guide](BACKEND_REPOSITORIES.md).

Persistence models contain mappings and may expose pure accessors over already-loaded fields, as described in the [schema guide](BACKEND_DATABASE_SCHEMA.md#do-not-query-other-tables-inside-property). They must not own business rules, orchestration, queries, session access, or caching.

Other adapters implement ports over external services, caches, queues, and legacy runtime code. Translate dependency failures into application errors so the use case stays independent of the implementation.

## Consistency

Each repository operation owns a short database session; each write operation owns one bounded transaction. Separate repository calls do not share a transaction. Writes that must succeed or fail together belong in one repository operation. A use case that performs a single such operation can therefore commit all its writes atomically.

Checking a mutable fact in the service before a write is not atomic with that write. Moving the check inside the write transaction is necessary in some cases but is not sufficient on its own: concurrent transactions can still observe the same state and both write.

For each rule that concurrent writers can break, document the enforcement mechanism on the port:

- A **database constraint**, translated into an application error when violated.
- A **conditional write**, guarded by expected state or a version, with zero affected rows treated as a conflict.
- A **lock or stricter isolation** covering the check and write, with retries or a clear conflict error.

Checks on immutable facts, such as a record's creator, need no extra coordination inside the write transaction beyond handling a concurrently deleted record. See the [SQLAlchemy guide](BACKEND_SQLALCHEMY.md) for implementation patterns.

## Side effects and delivery

Keep non-database I/O, such as calls to other services, outside open database transactions. After the write commits, application orchestration requests dependent side effects through ports. The write port returns the information needed for that work.

A process can fail between committing state and sending a notification. When delivery must be durable, store the delivery intent with the state change in the same transaction, then dispatch it with retries and idempotency. A **transactional outbox** is one way to do this: it stores pending messages alongside the business update. Database notifications also belong to adapters and must respect commit visibility.

## Example: workflow comments

The existing [`WorkflowCommentService`](../api/services/app/workflow_comment_service.py) calls a store and then a notifier. Its [repository](../api/repositories/app/workflow_comment_repository.py) handles persistence, and its [Celery notification adapter](../api/services/app/workflow_comment_mention_gateway.py) handles delivery.

If comment behavior is extracted into a domain model, content rules, creator-only edits, and resolution transitions can belong to a `WorkflowCommentAgg` in `api/domain/workflow_comments/workflow_comment_agg.py`. A separate recipient policy is useful only if it has business behavior that needs its own owner. These domain modules are illustrative, not existing files or required scaffolding.

The application service would still obtain membership facts and coordinate saving and notification. The repository would still enforce ownership and concurrency. Extracting the domain behavior does not move the store or notifier into the aggregate.

## Migrating legacy code

The domain package already contains implementations such as [`TraceRunAgg`](../api/domain/tracing/trace_run_agg.py). Other use cases still operate on plain records, with business rules in services or repositories. Introduce domain models where they clarify business behavior; a class name alone does not establish its role.

For example, [`WorkflowRunAgg`](../api/services/workflow_run_agg.py) coordinates execution, persistence, and publication through concrete infrastructure. It is legacy application orchestration, despite its name. Extract its business behavior before moving anything into the domain package.

The legacy `api/core/` package contains execution runtime code. Do not add new files or move extracted implementations there. When a change touches legacy services that manage sessions, handlers that query persistence, or runtime code that calls services:

- Migrate the touched use cases into their owning slices and remove replaced implementations and obsolete tests in the same change. Do not leave forwarding wrappers.
- Preserve routes, admission order, status codes, error codes and messages, and response fields. Comment deliberate compatibility behavior where it remains.
- Add the slice's boundary contracts and remove the dependency exceptions the migration eliminates.

## Boundary contracts

An **import-boundary contract** is an automated rule restricting which modules may depend on others. [`api/.importlinter`](../api/.importlinter) defines these contracts; they run in lint. Each new or migrated slice adds application and transport contracts in the same change: one keeps implementation dependencies out of application code, and the other keeps handlers from reaching persistence except through the composition root.

The existing `domain-boundary` contract covers the `domain` root package. Preserve its prohibition on application, persistence, framework, configuration, queue, transport, and legacy-runtime dependencies, including indirect imports through helpers. It supplements each slice's application and transport contracts.

The **legacy layering baseline** is the recorded set of exceptions for existing dependencies. It only shrinks: never add an exception, and remove one when its dependency is eliminated. Import checks cannot detect I/O hidden behind injected callbacks or ports, so review domain signatures and behavior as well.

## Review checks

For each finding, cite the violated rule. Check that:

- Responsibilities and dependencies follow the [code-location map](#responsibilities-and-code-locations), including the shared-utility boundary.
- Application contracts describe their records, errors, ownership scope, transaction boundaries, and enforced rules; ports expose neither sessions nor persistence models.
- Domain code follows its [placement and naming conventions](#domain-model-and-infrastructure-independence) and preserves invariants without infrastructure dependencies, including those hidden behind injected capabilities.
- Wiring stays in the composition root, and persistence models stay within their allowed mapping and accessor responsibilities.
- Resource access enforces the [ownership rules](#transport-and-ownership), and concurrent writes have a named [consistency mechanism](#consistency).
- Side effects follow the [commit and delivery rules](#side-effects-and-delivery), including durable delivery when required.
- Migrations preserve public behavior, add boundary contracts, remove obsolete code and exceptions, and follow the [testing guidelines](../api/README.md#testing).
