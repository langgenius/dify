# Rule Catalog - Repositories Abstraction

## Scope
- Covers: reaching tables through consumer-owned ports, reusing existing repositories, and preserving dependency direction between application services and persistence adapters.
- Does NOT cover: SQLAlchemy session lifecycle and query-shape specifics (handled by `sqlalchemy-rule.md`), table/schema/migration design (handled by `db-schema-rule.md`), and the full slice pattern (handled by `architecture-rule.md`).

## Rules

### Reach tables only through consumer-owned ports
- Category: maintainability
- Description: Application services never query tables or hold ORM rows. Each service declares the persistence it needs as a `Protocol` port (`XStore`, or `XQuery` for reads) in its own module, and a repository in `repositories/` implements that port. If a table already has a repository, extend it or let it implement the new port instead of adding parallel queries.
- Suggested fix:
  - First check `api/repositories`, `api/core/repositories`, and `api/extensions/*/repositories/` for an existing repository. If one exists, add the missing method there and type the dependency as the consumer's port.
  - Otherwise, declare the port in the application module and implement it in `repositories/<domain>/`, outside migration-only `api/core/`. The repository owns its sessions, filters by the full owner chain, returns records, and is wired only in the composition root.
- Example:
  - Bad:
    ```python
    # The service queries tables and mutates ORM rows itself.
    class AppService:
        def archive_app(self, app_id: str, tenant_id: str) -> None:
            app = self.session.execute(select(App).where(App.id == app_id, App.tenant_id == tenant_id)).scalar_one()
            app.archived = True
            self.session.commit()
    ```
  - Good:
    ```python
    # Case A: an existing repository gains the method the consumer's port declares.
    class AppArchiveStore(Protocol):
        def archive_app(self, *, workspace_id: str, app_id: str) -> None:
            """Raise `AppNotFoundError` if the app is outside the workspace."""
            ...


    class AppArchiveService:
        def __init__(self, *, apps: AppArchiveStore) -> None:
            self._apps = apps

        def archive_app(self, context: RequestContext, app_id: str) -> None:
            self._apps.archive_app(workspace_id=context.active_workspace_id, app_id=app_id)
    ```
  - Bad:
    ```python
    # Query logic for one domain is scattered across service code.
    class ConversationService:
        def list_recent_for_app(self, app_id: str, tenant_id: str, limit: int) -> list[Conversation]:
            ...
            # many filters/joins/pagination variants duplicated across services
    ```
  - Good:
    ```python
    # Case B: the service module owns the port and its records.
    class ConversationStore(Protocol):
        def list_recent(self, *, workspace_id: str, app_id: str, limit: int) -> Sequence[ConversationRecord]: ...


    class ConversationService:
        def __init__(self, *, conversations: ConversationStore) -> None:
            self._conversations = conversations


    # repositories/app/conversation_repository.py implements the port.
    class ConversationRepository(ConversationStore):
        def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
            self._session_factory = session_factory

        @override
        def list_recent(self, *, workspace_id: str, app_id: str, limit: int) -> list[ConversationRecord]: ...
    ```
