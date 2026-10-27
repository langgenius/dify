# Backend architecture

The backend uses a ports-and-adapters architecture, with application services orchestrating domain aggregates where business complexity warrants them. Each business capability is a slice. Application services own the use cases and declare ports for everything they need from outside. Adapters implement those ports, and a thin transport layer admits requests and translates them. One composition root connects the parts. The [API agent guide][api-guide] requires reading this document before backend changes; this document explains the architecture and how to review it. The legacy execution kernel is migration-only: never propose new files or extracted implementations there.

This document describes the architecture as it is today. Business rules live in application services that work with plain records, and no slice uses aggregates yet. The [next step](#next-step) section describes how aggregates are introduced.

## Layers

Dependencies point toward the application core. Outer layers know about inner ones; inner layers never know about outer ones.

- **Transport**: admits the caller, validates input, maps it to application inputs, calls one use case, translates application errors into protocol errors, and serializes the result. It holds no business rules and never touches persistence.
- **Application core**: application services own use cases and orchestration. Where business complexity warrants it, aggregates hold one business model's state and rules; services depend on aggregates, never the reverse. The core works only with plain values, the admitted caller identity, and the ports services declare. It never depends on the web framework, the ORM, persistence models, configuration, task queues, transport code, or concrete adapters.
- **Infrastructure**: repositories and other adapters implement ports over the database, caches, task queues, external services, the execution kernel, and legacy code. They depend on the contracts they implement, never on the transport layer.
- **Composition root**: the only place that chooses implementations, reads configuration, and constructs services. Everything else receives its dependencies.
- **Persistence models**: describe tables and nothing else.
- **Shared support types and utilities**: framework-neutral caller identity and business-agnostic utilities that any layer may use.

Import-boundary contracts encode these directions and run in lint. Treat a boundary violation as a design problem to fix, not an exception to record.

## Application services

An application module documents its boundary and business rules and contains:

- **Values**: immutable records for results and inputs. Records carry data, not behavior. Each optional field documents what its absence means. A state the use case reasons about is an application-owned enumeration, not a persistence detail.
- **Ports**: interfaces owned by the consumer and named for the role they play: persistence for this use case, a read-only query, a gateway to an external system or legacy code, or a narrow capability such as notification, verification, or encryption. Query ports return records. Persistence ports accept and return records today, and aggregates in slices that adopt them. A port's documentation is the contract every adapter honors: owner scope, transaction boundary, the rules it enforces, the concurrency mechanism behind each of those rules, and the errors it raises.
- **Errors**: one base error per slice with specific subtypes that carry user-facing messages. Errors carry no protocol status or response shape.
- **Services**: receive ports and plain settings at construction. Every use case takes the admitted caller identity first, derives its scope from that identity, enforces business rules, calls ports with explicit owner identifiers, and returns records.

Split a large business area into shared contracts, ports, one module per use-case group, and adapters instead of one large module. A read with no rule beyond owner scoping may be a query port that a repository implements directly; add a service once the read gains rules.

## Adapters

- **Repositories** implement persistence and query ports. Each operation owns its database session: a short read or one bounded write transaction. Every statement filters by the complete owner chain. Rows become records, or aggregates in slices that adopt them, before the session closes, so sessions, persistence models, and lazy relationships never cross a port. A repository depends only on the application contracts it implements.
- **Rules in repositories**: a repository enforces a business rule only when the rule must hold atomically with the write. When concurrent writers can change the state the rule reads, it uses a mechanism from the [consistency](#consistency) section. The port documents every rule its adapters enforce.
- **Runtime adapters** implement the remaining ports over caches, task queues, enterprise or external services, the execution kernel, or legacy code. They translate third-party failures into application errors.
- **Reuse**: one repository may implement several consumer-owned ports. Extend it instead of adding a parallel query path; see the [repositories rule][repositories].

## Consistency

Each repository operation runs in its own session, and no transaction spans a whole use case, so a rule that a service checks before a write is not atomic with that write. Moving the check inside the write transaction does not fix this on its own: at the default isolation level, two concurrent transactions can both see the same state and both write.

For every rule that concurrent writers can break, name the mechanism that enforces it and document it on the port:

- **A database constraint**, such as a unique or check constraint, translated into the slice's error when it is violated.
- **A conditional write**, such as an update guarded by the expected current state or by a version, that treats zero affected rows as a conflict.
- **A lock or stricter isolation** held across the check and the write, with a retry or a clear error on conflict.

A check that reads only values that never change after creation, such as who created a record, needs no extra coordination inside the write transaction, apart from handling a record that was deleted concurrently.

## Composition root

Register every service in the composition root and group related services by business area. Construct concrete adapters there, read configuration there, and pass plain values in. Services never build their own dependencies, and nothing outside the root creates repositories or module-level service instances.

## Transport layer

A handler:

1. Declares admission, including role and permission checks, which yields the framework-neutral caller identity.
2. Validates the request and maps it into the use case's input record. It resolves protocol conventions here, such as a masked secret that a client echoes back.
3. Calls exactly one use case obtained from the composition root.
4. Translates application errors into the established protocol errors and keeps the existing status, error code, and message.
5. Serializes the returned records with the shared response schemas, following the [API schema guide][schema-guide].

## Business rules

- Pass owner identifiers explicitly into every port call. Below the transport layer, never read the tenant or account from framework globals.
- Keep external I/O outside open transactions. Materialize what the I/O needs and close the session first.
- Trigger side effects after the write commits. The write port returns what the effect needs, and the service triggers it through its own port.
- Keep persistence models free of session access, queries, caching, and application behavior. The repository maps application-owned states to primitive columns.
- Raise protocol errors and build responses only in the transport layer.
- Reach another slice through its contracts and ports, never through its repositories or internals.

## Boundary contracts

Every new or migrated slice adds two import-boundary contracts in the same change. One keeps the application module free of framework, persistence, configuration, task-queue, and transport imports. The other keeps the handler from reaching persistence except through the composition root. A slice that adds an aggregate also adds a contract that keeps the aggregate module from importing the slice's service modules, because the other contracts keep infrastructure out of the application core but do not separate services from aggregates. The legacy layering baseline only shrinks: never add an exception, and remove the exception for each dependency a migration eliminates.

## Migrating legacy code

Legacy services that manage sessions themselves, handlers that query persistence models, and kernel code that calls services are migration debt. When a change touches them:

- Move the touched use cases into a slice and delete the replaced code and its tests in the same change. Do not leave forwarding wrappers.
- Preserve the public contract: routes, admission order, status codes, error codes and messages, and response fields. Comment deliberate legacy compatibility where it is kept.
- Add the slice's boundary contracts and shrink the legacy baseline.

## Tests

Test each seam with real objects:

- **Aggregates**: their behavior and rules, directly, without ports.
- **Application services**: in-memory port implementations that assert the owner scope of every call.
- **Repositories**: a real lightweight database session, covering owner scoping, ordering, record mapping, and not-found behavior.
- **Runtime adapters**: the external contract and failure translation.
- **Composition root**: the wiring of each service.
- **Handlers**: admission, input mapping, error translation, and the wire contract.

Do not introduce mock doubles; CI rejects new ones.

## Business-agnostic libraries

Shared libraries must not own product policy or orchestration. Move business decisions to their application owner and keep only reusable infrastructure in libraries.

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
- An aggregate root whose name does not end with Agg, a child entity named as if it were an aggregate, or an aggregate that depends on application services, ports, sessions, persistence models, configuration, or infrastructure.
- New code in the legacy execution kernel, or product policy in shared libraries.
- Tests that replace ports with mock doubles.

## Next step

Records carry no behavior, so business rules collect in application services and sometimes in repositories. Services currently contain rules that can move into aggregates. The next step introduces aggregates for specific business models where business complexity warrants them. SQLAlchemy models never become the domain model; they stay table mappings.

- **Aggregates**: an aggregate is the domain model for one business model and its consistency boundary. Its root holds the state of the model and of the child entities that exist only inside it, and enforces the invariants and state transitions. It depends only on plain values, never on application services, ports, sessions, persistence models, configuration, or infrastructure.
- **Services and aggregates**: both live in the application core but keep separate roles. An application service orchestrates a use case: it loads an aggregate through a repository port, calls its behavior, saves it through the same port, and triggers side effects after the save commits. Services depend on aggregates, and aggregates never depend on services.
- **Placement and naming**: aggregates live in the same directory as the services of their business area. Names tell them apart: the aggregate root and its module end with the suffix Agg. Child entities take plain names, because they are not aggregates of their own.
- **Ports**: an aggregate repository port accepts and returns aggregates, and a query port returns records. Sessions and SQLAlchemy models never cross either kind. Use cases return records, so the transport layer never receives an aggregate.
- **Repositories**: aggregate repositories load and save whole aggregates and map them to and from SQLAlchemy models. Rules that repositories enforce today move into aggregates. Rules that span aggregates, such as uniqueness, stay with the database, as the [consistency](#consistency) section describes.
- **Consistency**: a load and the later save run in separate transactions, so a decision made on loaded state can be stale when it is saved. For every invariant that concurrent writers can break, the slice names the mechanism from the [consistency](#consistency) section that protects it. Writing only the difference between the loaded and the changed aggregate keeps concurrent changes to other parts of the aggregate. It is a limited strategy, not a consistency guarantee: it does not protect decisions that rest on state a concurrent writer can change, and two competing transitions still end with the last writer.

Adopt this slice by slice, starting with services whose rules belong to one business model, and add the aggregate contract from the [boundary contracts](#boundary-contracts) section with the first aggregate in each slice.

[api-guide]: ../../../../api/AGENTS.md
[repositories]: repositories-rule.md
[schema-guide]: ../../../../api/controllers/API_SCHEMA_GUIDE.md
