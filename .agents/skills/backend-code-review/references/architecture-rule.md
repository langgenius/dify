# Backend architecture

The backend uses layered application services with ports and adapters. Each business capability is a slice. Application services own the use cases and business rules and declare ports for everything they need from outside. Adapters implement those ports, and a thin transport layer admits requests and translates them. One composition root connects the parts. The [API agent guide][api-guide] states the condensed rules; this document explains the architecture and how to review it. The legacy execution kernel is migration-only: never propose new files or extracted implementations there.

This document describes the architecture as it is today. Most business rules live in application services that work with plain records. Aggregates are being introduced slice by slice, as the [next step](#next-step) section describes.

## Layers

Dependencies point toward the application layer. Outer layers know about inner ones; inner layers never know about outer ones.

- **Transport**: admits the caller, validates input, maps it to application inputs, calls one use case, translates application errors into protocol errors, and serializes the result. It holds no business rules and never touches persistence.
- **Application**: owns use cases and business rules. It works only with plain values, the admitted caller identity, and the ports it declares. It never depends on the web framework, the ORM, persistence models, configuration, task queues, transport code, or concrete adapters.
- **Infrastructure**: repositories and other adapters implement ports over the database, caches, task queues, external services, the execution kernel, and legacy code. They depend on the contracts they implement, never on the transport layer.
- **Composition root**: the only place that chooses implementations, reads configuration, and constructs services. Everything else receives its dependencies.
- **Persistence models**: describe tables and nothing else.
- **Shared kernel**: framework-neutral caller identity and business-agnostic utilities that any layer may use.

Import-boundary contracts encode these directions and run in lint. Treat a boundary violation as a design problem to fix, not an exception to record.

## Application layer

An application module documents its boundary and business rules and contains:

- **Values**: immutable records for results and inputs. Records carry data, not behavior. Each optional field documents what its absence means. A state the use case reasons about is an application-owned enumeration, not a persistence detail.
- **Ports**: interfaces owned by the consumer and named for the role they play: persistence for this use case, a read-only query, a gateway to an external system or legacy code, or a narrow capability such as notification, verification, or encryption. A port's documentation is the contract every adapter honors: owner scope, transaction boundary, the rules it enforces, and the errors it raises.
- **Errors**: one base error per slice with specific subtypes that carry user-facing messages. Errors carry no protocol status or response shape.
- **Services**: receive ports and plain settings at construction. Every use case takes the admitted caller identity first, derives its scope from that identity, enforces business rules, calls ports with explicit owner identifiers, and returns records.

Split a large business area into shared contracts, ports, one module per use-case group, and adapters instead of one large module. A read with no rule beyond owner scoping may be a query port that a repository implements directly; add a service once the read gains rules.

## Adapters

- **Repositories** implement persistence and query ports. Each operation owns its database session: a short read or one bounded write transaction. Every statement filters by the complete owner chain. Rows become records before the session closes, so sessions, persistence models, and lazy relationships never cross a port. A repository depends only on the application contracts it implements.
- **Rules in repositories**: a repository enforces a business rule only when the rule must hold atomically with the write, such as checking the acting account inside the write transaction. The port documents every rule its adapters enforce.
- **Runtime adapters** implement the remaining ports over caches, task queues, enterprise or external services, the execution kernel, or legacy code. They translate third-party failures into application errors.
- **Reuse**: one repository may implement several consumer-owned ports. Extend it instead of adding a parallel query path; see the [repositories rule][repositories].

## Consistency

Each repository operation runs in its own session, and no transaction spans a whole use case. A rule that a service checks before a write is therefore not atomic with that write. When a rule must hold under concurrency, such as uniqueness, enforce it inside the write operation or with a database constraint, and document it on the port.

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

Every new or migrated slice adds two import-boundary contracts in the same change. One keeps the application module free of framework, persistence, configuration, task-queue, and transport imports. The other keeps the handler from reaching persistence except through the composition root. The legacy layering baseline only shrinks: never add an exception, and remove the exception for each dependency a migration eliminates.

## Migrating legacy code

Legacy services that manage sessions themselves, handlers that query persistence models, and kernel code that calls services are migration debt. When a change touches them:

- Move the touched use cases into a slice and delete the replaced code and its tests in the same change. Do not leave forwarding wrappers.
- Preserve the public contract: routes, admission order, status codes, error codes and messages, and response fields. Comment deliberate legacy compatibility where it is kept.
- Add the slice's boundary contracts and shrink the legacy baseline.

## Tests

Test each seam with real objects:

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
- A port that exposes sessions or persistence models, or an adapter operation that misses an owner-chain filter.
- A rule that must hold under concurrency but is only checked before a separate write.
- A business rule enforced in a repository that its port does not document.
- Dependencies chosen outside the composition root.
- A new or migrated slice without boundary contracts, a weakened contract, or a new baseline exception.
- Persistence models that gain behavior. They never become the domain model.
- An aggregate whose name does not end with Agg, or that depends on sessions, persistence models, configuration, or infrastructure.
- New code in the legacy execution kernel, or product policy in shared libraries.
- Tests that replace ports with mock doubles.

## Next step

Records carry no behavior, so most business rules still collect in application services, and sometimes in repositories. Some of those services already act as aggregates. The next step introduces aggregates for specific business models. One slice has adopted them as a pilot, and this section records what it settled. SQLAlchemy models never become the domain model; they stay table mappings.

- **Aggregates**: an aggregate represents one business model and its consistency boundary, such as a record together with the child records that exist only inside it. It holds the model's state and enforces its invariants and state transitions, including who may change it. It depends only on plain values and the slice's errors, never on sessions, persistence models, configuration, or infrastructure.
- **Immutability**: an aggregate is an immutable value. Each behavior checks its rules and returns the changed aggregate, so the loaded state stays available for the save.
- **Placement and naming**: aggregates live in their own module in the same directory as the services of their business area. Names tell them apart: the module and every unit that represents an aggregate or one of its parts end with the suffix Agg. The slice's errors move to a module of their own, so the aggregate and the service share them without importing each other.
- **Values from outside**: the service supplies new identifiers and the current time. The aggregate then owns its timestamps and stays deterministic in tests. The clock is a dependency the composition root provides.
- **Services**: services keep orchestration and hand entity rules to aggregates. A use case first checks its input against the aggregate's rules, so malformed input still fails before any database work and errors keep their order. It then loads the aggregate through a repository port, calls its behavior, saves the loaded and the changed aggregate through the same port, and triggers side effects after the save commits. The aggregate reports which side effects a change calls for, such as the users it newly mentions, and the write returns the data those effects need. Use cases still return records built from the aggregate, so aggregates never leave the application layer.
- **Reads**: reads that only present data keep returning records straight from a query, without loading aggregates.
- **Repositories**: repositories load and save whole aggregates and map them to and from SQLAlchemy models. They apply none of the rules the aggregate owns. A rule that needs another aggregate's state, such as uniqueness or keeping only workspace members among mentioned users, stays inside the write or in a database constraint, and the port documents it.
- **Consistency**: a load and the later save run in separate transactions, and there are three ways to keep them consistent.
  - A version that the save checks and increments rejects or retries a save when anything changed since the load. It protects every invariant, but it needs a schema change, and unrelated concurrent changes, such as two new child records, conflict with each other.
  - Repeating the deciding check inside the write, such as the acting account's ownership, keeps that rule atomic, but the rule then lives in both the aggregate and the repository.
  - A save that writes only the difference between the loaded and the changed aggregate, under a lock on the aggregate's root row, leaves concurrent changes to other parts of the aggregate intact. It fails with not found when the aggregate or the child it changes was deleted after the load. No rule moves into the repository.

  The pilot chose the difference save. Each decision its aggregate makes rests on a value that never changes after creation, such as who created a record, or is a one-way transition that a concurrent request can only repeat. Switch to a version check once an aggregate enforces an invariant over state that concurrent writers can change, such as a limit on child records or competing state transitions.
- **Tests**: test aggregate behaviors directly. Service tests use in-memory ports that keep aggregates and assert that each save receives the state that was loaded. Repository tests cover the mapping, writing only the difference, and two loads of the same aggregate saved one after the other.
- **Boundary contracts**: aggregates belong to the application layer, so the aggregate and errors modules join the slice's existing application contract, and no new kind of contract is needed.

Adopt this slice by slice, starting with services that already act as aggregates.

[api-guide]: ../../../../api/AGENTS.md
[repositories]: repositories-rule.md
[schema-guide]: ../../../../api/controllers/API_SCHEMA_GUIDE.md
