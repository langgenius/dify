# Backend architecture

The backend uses a ports-and-adapters architecture, with application services orchestrating domain aggregates and domain services where business complexity warrants them. Each business capability is a slice. Application services own the use cases and declare ports for everything they need from outside. Adapters implement those ports, and a thin transport layer admits requests and translates them. One composition root connects the parts. The [API agent guide](../api/AGENTS.md) requires reading this document before backend changes; this document explains the architecture and how to review it. The legacy execution kernel is migration-only: never propose new files or extracted implementations there.

Most existing services are application services: they coordinate use cases, persistence, and other capabilities. Migrated slices primarily work with plain records, so business rules still collect in application services and repositories. The dedicated `api/domain/` package described below is a target for new or extracted domain code; it does not exist yet.

Class names do not establish architectural roles. For example, [`WorkflowRunAgg`](../api/services/workflow_run_agg.py) coordinates execution, persistence, and publication and depends on concrete repositories and runtime infrastructure. It is an application orchestration component with legacy coupling, not a pure DDD aggregate. Extract its business behavior before moving anything into the domain package; moving or renaming the whole class would not establish the boundary.

## Layers

Dependencies point toward the application core. Outer layers know about inner ones; inner layers never know about outer ones.

- **Transport**: admits the caller, validates input, maps it to application inputs, calls one use case, translates application errors into protocol errors, and serializes the result. It holds no business rules and never touches persistence.
- **Application layer**: application services own use cases and orchestration. They work with plain values, the admitted caller identity, domain objects, and the ports they declare. They never depend on the web framework, the ORM, persistence models, configuration, task queues, transport code, or concrete adapters.
- **Domain layer**: aggregates, entities, value objects, and domain services own business state, invariants, transitions, and policies. They perform no external I/O and depend on neither the application layer nor infrastructure. The application and domain layers together form the application core; this is a logical boundary, not the legacy `api/core/` directory.
- **Infrastructure**: repositories and other adapters implement ports over the database, caches, task queues, external services, the execution kernel, and legacy code. They depend on the contracts they implement, never on the transport layer.
- **Composition root**: the only place that chooses implementations, reads configuration, and constructs services. Everything else receives its dependencies.
- **Persistence models**: describe tables and nothing else.
- **Shared support types and utilities**: framework-neutral caller identity and business-agnostic utilities that any layer may use.

Import-boundary contracts encode these directions and run in lint. Treat a boundary violation as a design problem to fix, not an exception to record.

## Application services

An application module documents its boundary and business rules and contains:

- **Values**: immutable records for results and inputs. Records carry data, not behavior; they are not DDD entities or value objects merely because they are named `Entity`. Each optional field documents what its absence means. State belongs to the application contract or, when it participates in domain behavior, to the domain model, never to persistence alone.
- **Ports**: interfaces owned by the consumer and named for the role they play: persistence for this use case, a read-only query, a gateway to an external system or legacy code, or a narrow capability such as notification, verification, or encryption. Query ports return records. Persistence ports accept and return records today, and aggregates in slices that adopt them. A port's documentation is the contract every adapter honors: owner scope, transaction boundary, the rules it enforces, the concurrency mechanism behind each of those rules, and the errors it raises.
- **Errors**: one application error base per slice with specific subtypes that carry user-facing messages. Translate domain failures into these errors at the application boundary when needed to preserve the public contract. Neither application nor domain errors carry protocol status or response shape; domain errors belong to the domain package and never inherit from application errors.
- **Services**: receive ports and plain settings at construction. Every use case takes the admitted caller identity first, derives its scope from that identity, obtains the facts needed by domain behavior, invokes that behavior, calls ports with explicit owner identifiers, and returns records. In slices without a domain model, existing business rules remain here until extracted. Once extracted, the domain is the rule's owner; do not duplicate the rule in the service.

Split a large business area into shared contracts, ports, one module per use-case group, and adapters instead of one large module. A read with no rule beyond owner scoping may be a query port that a repository implements directly; add a service once the read gains rules.

## Application services and domain services

An application service implements a use case: it determines which work to perform and in what order. A domain service implements a business operation that does not naturally belong to an entity or value object. Calling several repositories or sending a notification is orchestration, not a reason to introduce a domain service. These roles follow the separation in [Eric Evans's DDD reference](https://www.domainlanguage.com/wp-content/uploads/2016/05/DDD_Reference_2015-03.pdf); the no-I/O domain boundary and application-owned ports are this repository's concrete policy.

| Concern | Application service | Domain service |
| --- | --- | --- |
| Responsibility | Coordinate a use case and its success or failure path. | Express a business calculation, decision, or policy without a natural entity owner. |
| Inputs | Admitted caller identity and use-case inputs; load other facts through ports. | Domain objects and explicit business facts already obtained by the caller. |
| State | Coordinate progress; business state belongs to domain objects when a domain model exists. | No independently persisted identity or lifecycle; operate on supplied state. |
| Dependencies | Domain behavior and consumer-owned persistence, query, and gateway ports. | Domain types and pure helpers; no repositories, application services, or I/O ports. |
| Persistence | Ask a repository port to load or save; the adapter owns the session and transaction. | No queries, saves, commits, or ORM objects, including through injected interfaces. |
| Notifications | Request delivery through a port after a successful commit. | May produce a business result or event value; never deliver it. |

Keep a rule on its entity or aggregate when that is its natural owner. Use a domain service only for the remaining domain operation, which may involve several domain objects. A named function is sufficient for a small stateless policy; an interface or service class is not mandatory. Merely involving several objects does not make an operation a domain service, and using one does not make writes to several aggregates atomic.

## Domain model and purity

In DDD, an **aggregate** is a consistency boundary, not a database aggregation or a collection of infrastructure dependencies:

- **Entity**: a business object with identity that persists across state changes. Its methods enforce its own valid behavior. A child entity is changed through its aggregate root so the root can protect aggregate-wide invariants.
- **Value object**: a business value defined by its attributes, without independent identity. It can validate its invariants and provide business operations; it is not simply an application input or response record.
- **Aggregate**: a root entity and any child entities or value objects whose invariants must be maintained together. The root controls changes to the boundary. A single entity can be an aggregate; do not mirror every table relationship or load an entire business area by default.
- **Domain service**: a business policy or operation without a natural entity or value-object owner. It can call domain behavior, but must respect aggregate boundaries and cannot bypass their invariants.

Pure business logic can change an aggregate's in-memory state. Purity here means freedom from external effects and hidden infrastructure dependencies, not that every method must return a new immutable object. Given the same business state and explicit inputs, the decision should be reproducible. Pass in the current time, generated identifiers, membership facts, or policy values when a rule needs them; do not obtain them from clocks, framework globals, configuration, databases, or remote systems inside the domain.

Aggregates, entities, value objects, and domain services must not query or persist data, manage sessions or transactions, publish database notifications, dispatch signals, enqueue tasks, send email, access caches or storage, or call external APIs. Hiding those operations behind an injected repository, notifier, callback, or event bus does not make them domain logic. Application services obtain the required facts and perform effects through their own ports; adapters implement the technical operations.

A domain operation may return or record a plain domain event describing a business fact. Recording that value in memory is distinct from publishing it. Application orchestration owns handling the result and arranging delivery after the corresponding state commits. Domain code does not know about dispatchers, delivery retries, or outbox tables. Use a direct result when an event adds no value.

## Placement and dependencies

Place pure domain code under `api/domain/<business_area>/`, grouped by business capability. Keep application use cases and their ports under `api/services/`, persistence adapters under `api/repositories/`, and wiring in `api/extensions/ext_application_services.py` and its `application_services/` modules. Existing runtime adapter locations can remain where they are. The new domain package creates an explicit boundary without requiring a rename of the application-service tree.

For example, a future extraction of workflow comment behavior could use this layout. These domain files are illustrative, not existing modules or required scaffolding:

```text
api/
  domain/
    workflow_comments/
      workflow_comment_agg.py  # WorkflowCommentAgg and its owned domain types
      mention_policy.py       # Pure recipient eligibility policy, if needed
      errors.py               # Business failures, if separate errors are needed
  services/
    app/
      workflow_comment_service.py          # Use cases, records, and ports
      workflow_comment_mention_gateway.py  # Existing delivery adapter
  repositories/
    app/
      workflow_comment_repository.py       # SQLAlchemy mapping and transactions
  extensions/
    ext_application_services.py            # Composition root
```

Keep an aggregate and its small child types together until separate modules are useful. Root class names end in `Agg`, and their Python modules end in `_agg.py`; child entities use ordinary business names. Name domain services for their policy or operation. Do not create global `aggregates/`, `entities/`, and `services/` buckets that separate one business model across the tree. `api/models/` remains persistence mappings, `api/core/` remains the migration-only execution kernel, and business-agnostic `api/libs/` is not a home for product rules.

Imports point from application services to domain code. Repositories may import domain types to reconstruct and persist aggregates, as well as the application ports they implement. Domain code never imports `services`, `repositories`, `models`, `controllers`, `extensions`, `configs`, `tasks`, or the legacy `core` package. It uses its own domain types, standard-library values, and pure helpers whose dependencies preserve this boundary. Transport continues to call application use cases and receive records. Keep each business area's domain internals private; another slice reaches it through application contracts and ports.

The existing [`WorkflowCommentService`](../api/services/app/workflow_comment_service.py) demonstrates application orchestration: it calls a store and then a notifier. In a domain extraction, comment content rules, creator-only edits, and resolution transitions can belong to `WorkflowCommentAgg`; a recipient policy can operate on supplied mention and membership facts if it needs a separate owner. The application service still obtains those facts and coordinates the save and notification, the repository still enforces owner scope and concurrency, and the existing Celery adapter still performs delivery. Do not move the store or notifier into the aggregate.

## Adapters

- **Repositories** implement persistence and query ports. Each operation owns its database session: a short read or one bounded write transaction. Every statement filters by the complete owner chain. Rows become records, or aggregates in slices that adopt them, before the session closes, so sessions, persistence models, and lazy relationships never cross a port. A repository depends on the application contracts it implements and the domain types it maps, never on application orchestration.
- **Rules in repositories**: a repository enforces a business rule only when the rule must hold atomically with the write. When concurrent writers can change the state the rule reads, it uses a mechanism from the [consistency](#consistency) section. For an extracted domain rule, reuse the domain behavior when evaluating it inside a transaction; do not create a second policy implementation in the adapter. Database constraints and conditional writes remain necessary enforcement mechanisms. The port documents every rule its adapters enforce.
- **Runtime adapters** implement the remaining ports over caches, task queues, enterprise or external services, the execution kernel, or legacy code. They translate third-party failures into application errors.
- **Reuse**: one repository may implement several consumer-owned ports. Extend it instead of adding a parallel query path; see the [repositories guide](BACKEND_REPOSITORIES.md).

## Consistency

Each repository operation runs in its own session, and no transaction spans a whole use case, so a rule that a service checks before a write is not atomic with that write. Moving the check inside the write transaction does not fix this on its own: at the default isolation level, two concurrent transactions can both see the same state and both write.

For every rule that concurrent writers can break, name the mechanism that enforces it and document it on the port:

- **A database constraint**, such as a unique or check constraint, translated into the slice's error when it is violated.
- **A conditional write**, such as an update guarded by the expected current state or by a version, that treats zero affected rows as a conflict.
- **A lock or stricter isolation** held across the check and the write, with a retry or a clear error on conflict.

A check that reads only values that never change after creation, such as who created a record, needs no extra coordination inside the write transaction, apart from handling a record that was deleted concurrently.

## Composition root

Register every application service in the composition root and group related services by business area. Construct concrete adapters there, read configuration there, and pass plain values in. Application services never build their own infrastructure dependencies, and nothing outside the root creates repositories or module-level application-service instances. Pure domain functions and domain objects need no service registration.

## Transport layer

A handler:

1. Declares admission, including role and permission checks, which yields the framework-neutral caller identity.
2. Validates the request and maps it into the use case's input record. It resolves protocol conventions here, such as a masked secret that a client echoes back.
3. Calls exactly one use case obtained from the composition root.
4. Translates application errors into the established protocol errors and keeps the existing status, error code, and message.
5. Serializes the returned records with the shared response schemas, following the [API schema guide](../api/controllers/API_SCHEMA_GUIDE.md).

## Business rules

- Pass owner identifiers explicitly into every port call. Below the transport layer, never read the tenant or account from framework globals.
- Keep external I/O outside open transactions. Materialize what the I/O needs and close the session first.
- Trigger side effects after the write commits. The write port returns what the effect needs, and the application service triggers it through its own port. A domain event or in-memory state change alone is not evidence of a successful commit.
- Keep persistence models free of session access, queries, caching, and application behavior. The repository maps application- or domain-owned states to primitive columns.
- Raise protocol errors and build responses only in the transport layer.
- Reach another slice through its contracts and ports, never through its repositories or internals.

Post-commit dispatch alone does not guarantee delivery: a process can fail between the commit and the notification. When a use case requires durable delivery, persist its delivery intent with the state change in the same repository transaction and dispatch it afterward with retries and idempotency, for example through a transactional outbox. This is an application and infrastructure concern; it adds no database or notification dependency to the domain. Database-specific notification mechanisms also belong to adapters and must respect commit visibility.

## Boundary contracts

Every new or migrated slice adds two import-boundary contracts in the same change. One keeps the application module free of framework, persistence, configuration, task-queue, and transport imports. The other keeps the handler from reaching persistence except through the composition root. The legacy layering baseline only shrinks: never add an exception, and remove the exception for each dependency a migration eliminates.

When the first domain package is introduced, add `domain` to the root packages in `api/.importlinter` and add a domain contract covering aggregates, entities, value objects, and domain services. Forbid application, persistence, framework, configuration, queue, transport, and legacy-kernel dependencies, including indirect imports through helpers. Preserve each slice's application and transport contracts; the domain rule supplements them. Import checks do not detect I/O hidden behind injected capabilities, so review signatures and behavior as well. The package and this enforcement must land together; this document alone does not add lint enforcement.

## Migrating legacy code

Legacy services that manage sessions themselves, handlers that query persistence models, and kernel code that calls services are migration debt. When a change touches them:

- Move the touched use cases into a slice and delete the replaced code and its tests in the same change. Do not leave forwarding wrappers.
- Preserve the public contract: routes, admission order, status codes, error codes and messages, and response fields. Comment deliberate legacy compatibility where it is kept.
- Add the slice's boundary contracts and shrink the legacy baseline.

## Tests

Follow the backend developer guide's [testing guidelines](../api/README.md#testing).

## Business-agnostic libraries

Shared libraries must not own product policy or orchestration. Move business decisions to their domain owner, or to the owning application slice until it has a domain model, and keep only business-agnostic support in libraries.

## Review checks

Flag each finding with the rule it violates:

- A handler that touches persistence, queries data, calls legacy code a slice replaced, or decides business policy.
- An application module that depends on the framework, persistence, configuration, or task queues, or raises protocol errors.
- A port that exposes sessions or persistence models, an aggregate that reaches the transport layer, or an adapter operation that misses an owner-chain filter.
- A rule that concurrent writers can break without a named mechanism: a database constraint, a conditional write, or a lock or isolation level held across the check and the write.
- A business rule enforced in a repository that its port does not document.
- Dependencies chosen outside the composition root.
- A new or migrated slice without boundary contracts, a weakened contract, or a new baseline exception.
- Persistence models that gain behavior. They never become the domain model.
- An aggregate root whose name does not end with `Agg`, a child entity named as if it were an aggregate, or an orchestration component presented as a domain service or aggregate.
- Domain code outside its business-area package, or a domain object or service that depends on application services, I/O ports, sessions, persistence models, configuration, or infrastructure. Include notification and event-dispatch dependencies hidden behind interfaces.
- New code in the legacy execution kernel, or product policy in shared libraries.
- Tests that violate the [backend testing guidelines](../api/README.md#testing).
