# Rule Catalog - Repositories Abstraction

## Scope
- Covers: when to reuse existing repository abstractions, when to introduce new repositories, and how to preserve dependency direction between service/core and infrastructure implementations.
- Does NOT cover: SQLAlchemy session lifecycle and query-shape specifics (handled by `sqlalchemy-rule.md`), and table schema/migration design (handled by `db-schema-rule.md`).

## Rules

### Introduce repositories abstraction
- Category: maintainability
- Severity: suggestion
- Description: If a table/model already has a repository abstraction, all reads/writes/queries for that table should use the existing repository. If no repository exists, introduce one only when complexity justifies it, such as large/high-volume tables, repeated complex query logic, or likely storage-strategy variation.
- Suggested fix:
  - First check  `api/repositories`, `api/core/repositories`, and `api/extensions/*/repositories/` to verify whether the table/model already has a repository abstraction. If it exists, route all operations through it and add missing repository methods instead of bypassing it with ad-hoc SQLAlchemy access.
  - If no repository exists, add one only when complexity warrants it (for example, repeated complex queries, large data domains, or multiple storage strategies), while preserving dependency direction (service/core depends on abstraction; infra provides implementation).
- Example:
  - Bad:
    ```python
    # Existing repository is ignored and service uses ad-hoc table queries.
    class AppService:
        def archive_app(self, app_id: str, tenant_id: str) -> None:
            app = self.session.execute(
                select(App).where(App.id == app_id, App.tenant_id == tenant_id)
            ).scalar_one()
            app.archived = True
            self.session.commit()
    ```
  - Good:
    ```python
    # Case A: Existing repository must be reused for all table operations.
    class AppService:
        def archive_app(self, app_id: str, tenant_id: str) -> None:
            app = self.app_repo.get_by_id(app_id=app_id, tenant_id=tenant_id)
            app.archived = True
            self.app_repo.save(app)

    # If the query is missing, extend the existing abstraction.
    active_apps = self.app_repo.list_active_for_tenant(tenant_id=tenant_id)
    ```
  - Bad:
    ```python
    # No repository exists, but large-domain query logic is scattered in service code.
    class ConversationService:
        def list_recent_for_app(self, app_id: str, tenant_id: str, limit: int) -> list[Conversation]:
            ...
            # many filters/joins/pagination variants duplicated across services
    ```
  - Good:
    ```python
    # Case B: Introduce repository for large/complex domains or storage variation.
    class ConversationRepository(Protocol):
        def list_recent_for_app(self, app_id: str, tenant_id: str, limit: int) -> list[Conversation]: ...

    class SqlAlchemyConversationRepository:
        def list_recent_for_app(self, app_id: str, tenant_id: str, limit: int) -> list[Conversation]:
            ...

    class ConversationService:
        def __init__(self, conversation_repo: ConversationRepository):
            self.conversation_repo = conversation_repo
    ```
