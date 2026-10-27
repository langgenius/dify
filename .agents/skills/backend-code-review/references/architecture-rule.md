# Backend architecture

The backend uses a ports-and-adapters architecture. Each business capability is a slice. Application services own the use cases and declare ports for everything they need from outside; where business complexity warrants it, a domain model holds the business rules and the application services orchestrate it. Adapters implement the ports, and a thin transport layer admits requests and translates them. One composition root connects the parts. The [API agent guide][api-guide] requires reading this document before backend changes; this document explains the architecture and how to review it. The legacy execution kernel is migration-only: never propose new files or extracted implementations there.

This document describes the architecture as it is today. Most slices keep their business rules in application services that work with plain records, and one slice pilots a domain model. The [domain model](#domain-model) section defines its parts, and the [next step](#next-step) section describes how slices adopt one and what the pilot settled.

## Layers

Dependencies point inward: transport depends on application services, application services depend on the domain model, and the domain model depends on no other layer. Infrastructure depends only on the contracts it implements.

- **Transport**: admits the caller, validates input, maps it to application inputs, calls one use case, translates application errors into protocol errors, and serializes the result. It holds no business rules and never touches persistence.
- **Application**: application services own use cases and orchestration. They work only with plain values, the admitted caller identity, the domain model, and the ports they declare. They never depend on the web framework, the ORM, persistence models, configuration, task queues, transport code, or concrete adapters.
- **Domain model**: where business complexity warrants it, entities, aggregates, value objects, domain events, and domain services hold a business area's state and rules. The domain model depends only on plain values and the slice's errors, never on application services, ports, or anything the application layer may not depend on.
- **Infrastructure**: repositories and other adapters implement ports over the database, caches, task queues, external services, the execution kernel, and legacy code. They depend on the contracts they implement, never on the transport layer.
- **Composition root**: the only place that chooses implementations, reads configuration, and constructs services. Everything else receives its dependencies.
- **Persistence models**: describe tables and nothing else.
- **Shared support types and utilities**: framework-neutral caller identity and business-agnostic utilities that any layer may use.

Import-boundary contracts encode these directions and run in lint. Treat a boundary violation as a design problem to fix, not an exception to record.

## Application services

An application module documents its boundary and business rules and contains:

- **Values**: immutable records for results and inputs. Records carry data, not behavior, and are not the domain model's value objects. Each optional field documents what its absence means. A state the use case reasons about is an application-owned enumeration, not a persistence detail.
- **Ports**: interfaces owned by the consumer and named for the role they play: persistence for this use case, a read-only query, a gateway to an external system or legacy code, or a narrow capability such as notification, verification, or encryption. Query ports return records. Persistence ports accept and return records, except that an aggregate's repository port accepts and returns only that aggregate. A port's documentation is the contract every adapter honors: owner scope, transaction boundary, the rules it enforces, the concurrency mechanism behind each of those rules, and the errors it raises.
- **Errors**: one base error per slice with specific subtypes that carry user-facing messages. Errors carry no protocol status or response shape.
- **Services**: receive ports and plain settings at construction. Every use case takes the admitted caller identity first, derives its scope from that identity, calls ports with explicit owner identifiers, and returns records. In a slice without a domain model, the service enforces the business rules itself. In a slice with one, the domain model enforces them and the service only orchestrates.

Split a large business area into shared contracts, ports, one module per use-case group, and adapters instead of one large module. A read with no rule beyond owner scoping may be a query port that a repository implements directly; add a service once the read gains rules.

## Domain model

A slice introduces a domain model when its rules belong to a business model whose state and transitions need protecting, not to individual reads and writes. The domain model is business logic only. It performs no I/O and holds no persistence state, such as sessions, loaded snapshots, or change flags. It receives new identifiers and the current time from the application service, so it stays deterministic.

- **Entities** have an identity that is fixed when they are created and stays the same for their whole lifecycle. Two entities are equal when their identities are equal, whatever their state. Their state is mutable and changes only through their behaviors.
- **Aggregates** group entities and value objects into one consistency boundary. The root is an entity: code outside the aggregate holds and references only the root, and the root enforces the aggregate's invariants and state transitions. Child entities have an identity that is unique within the aggregate and are changed only through the root. An aggregate refers to another aggregate by identity, never by holding it, and one transaction changes one aggregate.
- **Value objects** describe a value that has no identity, such as checked text or a list of mentioned users. They are immutable, equal when their values are equal, and check their own rules when they are built, so an invalid value never exists.
- **Domain events** record facts that happened inside an aggregate and that other parts react to. The aggregate records them during its behavior, and the application service takes them after the save commits and triggers the reactions.
- **Domain services** hold a business rule that belongs to no single aggregate, as the next section describes.

### Application services and domain services

Both are called services, but they live in different layers and do different work.

| | Application service | Domain service |
|---|---|---|
| Layer | Application | Domain model |
| Purpose | Runs one use case for one caller | Applies a business rule that needs several aggregates, or values no aggregate owns |
| Works with | Caller identity, records, ports, and the domain model | Entities, value objects, and plain values only |
| I/O and transactions | Reads and writes through ports, decides what one change covers, and triggers side effects after the commit | None: no ports, repositories, transactions, clock, or identifier generation |
| Business decisions | None in a slice with a domain model: it passes input to the domain model and carries out the outcome | Yes: it makes the decision, and the application service carries it out |
| State | Only the ports and settings it receives at construction | None |
| Returns | Records | Domain objects or plain values |

To place a piece of logic, ask whether it decides a business outcome or coordinates. A decision belongs in the domain model: in the aggregate when it reads only that aggregate's state, and in a domain service when it needs several aggregates or values that no aggregate owns. Either way, the application service first reads what the decision needs through ports and passes it in. Coordination belongs in the application service: scoping by owner, loading, saving, mapping to records, and notifying. A domain service is named for the business operation it performs and lives with the aggregates of its business area, under the same import contract. The Service suffix stays reserved for application services; every existing service class in the backend is one.

## Adapters

- **Repositories** implement persistence and query ports. Each operation owns its database session: a short read, or one bounded write transaction. Every statement filters by the complete owner chain. Rows become records, or are rebuilt into aggregates in slices that have them, before the session closes, so sessions, persistence models, and lazy relationships never cross a port. A repository depends only on the application contracts it implements.
- **Rules in repositories**: a repository for records enforces a business rule only when the rule must hold atomically with the write. When concurrent writers can change the state the rule reads, it uses a mechanism from the [consistency](#consistency) section. The port documents every rule its adapters enforce. An aggregate's repository enforces no business rule: it provides the concurrency mechanism, and the aggregate makes every decision.
- **Runtime adapters** implement the remaining ports over caches, task queues, enterprise or external services, the execution kernel, or legacy code. They translate third-party failures into application errors.
- **Reuse**: one repository may implement several consumer-owned ports. Extend it instead of adding a parallel query path; see the [repositories rule][repositories].

## Consistency

Each repository operation runs in its own session, and no transaction spans a whole use case, so a rule that a service checks before a write is not atomic with that write. Moving the check inside the write transaction does not fix this on its own: at the default isolation level, two concurrent transactions can both see the same state and both write.

For every rule that concurrent writers can break, name the mechanism that enforces it and document it on the port:

- **A database constraint**, such as a unique or check constraint, translated into the slice's error when it is violated.
- **A conditional write**, such as an update guarded by the expected current state or by a version, that treats zero affected rows as a conflict.
- **A lock or stricter isolation** held across the check and the write, with a retry or a clear error on conflict.

A check that reads only values that never change after creation, such as who created a record, needs no extra coordination inside the write transaction, apart from handling a record that was deleted concurrently.

An aggregate decides on the state it was loaded with, so the load and the save must form one consistent change. One way is a single repository operation that locks the root row, reads the aggregate, lets the service apply the behavior, and saves in the same transaction. Only the aggregate's behavior runs while that transaction is open: no port calls and no external I/O. The other way is a save guarded by a version column, which reports a conflict that the service resolves by repeating the change. Either way the aggregate's rules hold without being repeated in the repository.

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
- Trigger side effects after the write commits. Without a domain model, the write port returns what the effect needs. With one, the aggregate records domain events, and after the commit the service reads what each reaction needs through a query port. Either way, the service triggers the effect through its own port.
- Keep persistence models free of session access, queries, caching, and application behavior. The repository maps application-owned states to primitive columns.
- Raise protocol errors and build responses only in the transport layer.
- Reach another slice through its contracts and ports, never through its repositories or internals.

## Boundary contracts

Every new or migrated slice adds two import-boundary contracts in the same change. One keeps the application module free of framework, persistence, configuration, task-queue, and transport imports. The other keeps the handler from reaching persistence except through the composition root. A slice that adds a domain model also adds a contract that keeps its domain model modules from importing the slice's service modules, because the other contracts keep infrastructure out of the application layer but do not separate it from the domain model. The legacy layering baseline only shrinks: never add an exception, and remove the exception for each dependency a migration eliminates.

## Migrating legacy code

Legacy services that manage sessions themselves, handlers that query persistence models, and kernel code that calls services are migration debt. When a change touches them:

- Move the touched use cases into a slice and delete the replaced code and its tests in the same change. Do not leave forwarding wrappers.
- Preserve the public contract: routes, admission order, status codes, error codes and messages, and response fields. Comment deliberate legacy compatibility where it is kept.
- Add the slice's boundary contracts and shrink the legacy baseline.

## Tests

Test each seam with real objects:

- **Domain model**: entities, value objects, domain events, and domain services directly, without ports.
- **Application services**: in-memory port implementations that assert the owner scope of every call.
- **Repositories**: a real lightweight database session, covering owner scoping, ordering, record and aggregate mapping, and not-found behavior.
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
- A business rule enforced in a repository that its port does not document, or any business decision in an aggregate's repository.
- Dependencies chosen outside the composition root.
- A new or migrated slice without boundary contracts, a weakened contract, or a new baseline exception.
- Persistence models that gain behavior. They never become the domain model.
- An aggregate root whose name does not end with Agg, a child entity named as if it were an aggregate, or a domain model that depends on application services, ports, sessions, persistence models, configuration, or infrastructure.
- An entity that compares by value instead of identity, a value object that can change after it is built, or a domain model that performs I/O, reads the clock, generates identifiers, or keeps state for its repository.
- An application service that makes a business decision its slice's domain model owns, or a domain service that calls ports, manages transactions, or is named with the Service suffix.
- New code in the legacy execution kernel, or product policy in shared libraries.
- Tests that replace ports with mock doubles.

## Next step

Records carry no behavior, so business rules collect in application services and sometimes in repositories. The next step moves them into domain models, slice by slice, where business complexity warrants it. SQLAlchemy models never become the domain model; they stay table mappings.

- **Placement and naming**: a business area's domain model lives in the same directory as its application services, in modules that an import contract keeps from importing those services. The aggregate root and its module end with the suffix Agg. Child entities, value objects, and domain events take plain names, because they are not aggregates of their own.
- **Ports**: an aggregate's repository port accepts and returns only that aggregate, and reads that only present data stay on query ports that return records. Sessions and SQLAlchemy models never cross either kind. Use cases return records, so the transport layer never receives an aggregate.
- **Repositories**: an aggregate repository rebuilds the aggregate from rows without re-running the checks that guard new input, and saves it whole. To write only what a change touched, the repository keeps its own copy of the state it read; the aggregate never tracks changes for persistence. Rules that repositories enforce today move into the domain model. A rule that needs another aggregate's state reads that state through a port before the change and lets the domain model apply it. A rule that must hold atomically across aggregates, such as uniqueness, stays with a database constraint, as the [consistency](#consistency) section describes.
- **Consistency**: every change to an aggregate uses one of the two ways in the [consistency](#consistency) section, and the slice's repository port lists each rule with what protects it, including the rules left unprotected.

### What the first pilot settled

One slice has adopted a domain model. These choices are specific to that pilot; the rules above still apply wherever they differ.

- **Model**: the aggregate root and its child entity are mutable entities compared by identity. Content and mention lists are value objects that check themselves when they are built. A change that newly mentions users records a domain event.
- **Errors**: the slice's errors live in a module of their own, so the domain model raises them without importing a service module.
- **Values from outside**: the service supplies new identifiers and the current time, and the composition root provides the clock. The aggregate owns its timestamps and stays deterministic in tests.
- **Input**: a use case builds its value objects from the input before any port call, so malformed input fails first and errors keep their order.
- **State from another aggregate**: workspace membership belongs to the workspace, so the service reads which mentioned users are members through a query port before the change, and the mention list keeps only those. That read is not atomic with the change, and the port names it as unprotected.
- **Changing**: the repository port yields the aggregate inside one transaction that locks the root row before reading the rest. Leaving the block saves what changed and commits, and an error rolls the whole change back. Changes to one aggregate therefore run one after another, and every rule is decided on current state, including a one-way transition that keeps its first outcome. Deleting checks only the creator, which never changes, so it loads without a lock and deletes under one.
- **Side effects**: after the change commits, the service takes the aggregate's domain events, reads the recipients through a query port, and sends the notifications.
- **Reads**: reads that only present data stay on query ports and do not load aggregates.
- **Tests**: domain tests cover the entities, value objects, and events without ports. Service tests use in-memory ports that keep aggregates and keep a change only when it succeeds. Repository tests run on a real lightweight database that cannot hold row locks, so they check the locking statement as the production database would run it, writing only what changed, and rolling back a failed change.

Adopt this slice by slice, starting with services whose rules belong to one business model, and add the domain model contract from the [boundary contracts](#boundary-contracts) section with the first aggregate in each slice.

[api-guide]: ../../../../api/AGENTS.md
[repositories]: repositories-rule.md
[schema-guide]: ../../../../api/controllers/API_SCHEMA_GUIDE.md
