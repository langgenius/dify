# Development principles: user and tenant isolation

Read this document before developing or changing any feature that involves users or tenants, including requests, background jobs, workflow runs, and their tests.

## Pass users and tenants explicitly

- Every operation involving a user or tenant must explicitly receive or create the corresponding user and tenant. Pass the required records or validated identifiers through function calls, constructors, and job payloads.
- Resolve the authorized user and tenant at the entry point. Validate the user's access to the tenant before starting work. Do not treat identifiers supplied by a caller as proof of access.
- When an operation creates a user or tenant, pass the resulting record or identifier to subsequent work. Tests must explicitly create their users, tenants, and ownership relationships too.
- Do not discover identity inside shared helpers through a global variable, singleton, thread-local value, or ambient request context. A helper must receive the identity it needs.
- Scope reads, writes, deletes, and resource lookups to the tenant and any required user ownership. Check the full ownership chain when a resource belongs to an app, conversation, workflow, or another resource. A resource ID alone is insufficient.
- Include the required user and tenant identifiers when scheduling work. Validate ownership again when consuming a job, retrying work, or restoring saved execution state. A background worker must not inherit another request's identity.
- For scheduled work with no human user, represent that fact explicitly and validate the target tenant and the job's authority. Do not borrow a previous user's identity or invent an account to satisfy a parameter.

## Do not share stateful objects

- Create objects that hold changing state for the operation that owns them. Never reuse those instances across requests, jobs, users, tenants, or independently running branches, even when they belong to the same tenant.
- This includes database sessions, clients with credentials or request settings, recorders, mutable configuration, buffers, and objects holding intermediate results. Do not store them in module variables, class attributes, singletons, or shared caches.
- Pass operation-owned objects explicitly to the helpers that use them. Give concurrent work its own objects and release them when that work finishes. A lock does not make a shared stateful object acceptable.
- Across queues, callbacks, and other asynchronous boundaries, pass immutable values or serialized data and construct fresh objects in the receiving operation. Do not pass a live session, client, or mutable object from the producer.
- Only stateless behavior and immutable data may be shared. A frozen wrapper around a mutable dictionary or client is still stateful.

## Check isolation before finishing

Trace user and tenant ownership from the entry point through storage and asynchronous work. Check that missing or mismatched ownership is rejected before data is read, changed, or sent elsewhere. For affected behavior, cover access from a second tenant and concurrent operations with different users or credentials so that leaked state is observable.
