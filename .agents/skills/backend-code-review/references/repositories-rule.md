# Rule Catalog - Repositories Abstraction

## Scope
- Covers: reaching persistence through consumer-owned ports, reusing existing repositories, and preserving dependency direction between application services and persistence adapters.
- Does NOT cover: SQLAlchemy session lifecycle and query-shape specifics (handled by `sqlalchemy-rule.md`), table/schema/migration design (handled by `db-schema-rule.md`), and the overall slice pattern (handled by `architecture-rule.md`).

## Rules

### Reach persistence only through consumer-owned ports
- Category: maintainability
- Description: Application services never query tables or hold persistence models. Each service declares the persistence it needs as a port in its own module, and a repository implements that port. When a table already has a repository, extend it or let it implement the new port instead of adding a parallel query path.
- Suggested fix:
  - First check `api/repositories`, `api/core/repositories`, and `api/extensions/*/repositories/` for an existing repository. If one exists, add the missing operation there and depend on it through the consumer's port.
  - Otherwise, declare the port next to the service that needs it and implement it in a repository outside migration-only `api/core/`. The repository owns its sessions, filters by the complete owner chain, returns plain records, and is wired only in the composition root.
- Example:
  - Bad: a service opens a session, queries a table, changes the loaded persistence model, and commits.
  - Good: the service calls an operation on a port it declares, passing the owner identifiers. The repository behind that port performs the scoped write in one bounded transaction and reports a missing target with a domain error.
  - Bad: filters, joins, and pagination for one domain are repeated across several services.
  - Good: the services share one port for that domain's reads, and a single repository implements it.
