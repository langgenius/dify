# Rule Catalog — DB Schema Design

## Scope
- Covers: model/base inheritance, schema boundaries in model properties, tenant-aware schema design, index redundancy checks, dialect portability in models, and cross-database compatibility in migrations.
- Does NOT cover: session lifecycle, transaction boundaries, and query execution patterns (handled by `sqlalchemy-rule.md`).

## Rules

### Do not query other tables inside `@property`
- Category: [maintainability, performance]
- Severity: critical
- Description: A model `@property` must not open sessions or query other tables. This hides dependencies across models, tightly couples schema objects to data access, and can cause N+1 query explosions when iterating collections.
- Suggested fix:
  - Keep model properties pure and local to already-loaded fields.
  - Move cross-table data fetching to service/repository methods.
  - For list/batch reads, fetch required related data explicitly (join/preload/bulk query) before rendering derived values.
- Example:
  - Bad:
    ```python
    class Conversation(TypeBase):
        __tablename__ = "conversations"

        @property
        def app_name(self) -> str:
            with Session(db.engine, expire_on_commit=False) as session:
                app = session.execute(select(App).where(App.id == self.app_id)).scalar_one()
                return app.name
    ```
  - Good:
    ```python
    class Conversation(TypeBase):
        __tablename__ = "conversations"

        @property
        def display_title(self) -> str:
            return self.name or "Untitled"


    # Service/repository layer performs explicit batch fetch for related App rows.
    ```

### Prefer including `tenant_id` in model definitions
- Category: maintainability
- Severity: suggestion
- Description: In multi-tenant domains, include `tenant_id` in schema definitions whenever the entity belongs to tenant-owned data. This improves data isolation safety and keeps future partitioning/sharding strategies practical as data volume grows.
- Suggested fix:
  - Add a `tenant_id` column and ensure related unique/index constraints include tenant dimension when applicable.
  - Propagate `tenant_id` through service/repository contracts to keep access paths tenant-aware.
  - Exception: if a table is explicitly designed as non-tenant-scoped global metadata, document that design decision clearly.
- Example:
  - Bad:
    ```python
    from sqlalchemy.orm import Mapped

    class Dataset(TypeBase):
        __tablename__ = "datasets"
        id: Mapped[str] = mapped_column(StringUUID, primary_key=True)
        name: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    ```
  - Good:
    ```python
    from sqlalchemy.orm import Mapped

    class Dataset(TypeBase):
        __tablename__ = "datasets"
        id: Mapped[str] = mapped_column(StringUUID, primary_key=True)
        tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False, index=True)
        name: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    ```

### Detect and avoid duplicate/redundant indexes
- Category: performance
- Severity: suggestion
- Description: Review index definitions for leftmost-prefix redundancy. For example, index `(a, b, c)` can safely cover most lookups for `(a, b)`. Keeping both may increase write overhead and can mislead the optimizer into suboptimal execution plans.
- Suggested fix:
  - Before adding an index, compare against existing composite indexes by leftmost-prefix rules.
  - Drop or avoid creating redundant prefixes unless there is a proven query-pattern need.
  - Apply the same review standard in both model `__table_args__` and migration index DDL.
- Example:
  - Bad:
    ```python
    __table_args__ = (
        sa.Index("idx_msg_tenant_app", "tenant_id", "app_id"),
        sa.Index("idx_msg_tenant_app_created", "tenant_id", "app_id", "created_at"),
    )
    ```
  - Good:
    ```python
    __table_args__ = (
        # Keep the wider index unless profiling proves a dedicated short index is needed.
        sa.Index("idx_msg_tenant_app_created", "tenant_id", "app_id", "created_at"),
    )
    ```

### Avoid PostgreSQL-only dialect usage in models; wrap in `models.types`
- Category: maintainability
- Severity: critical
- Description: Model/schema definitions should avoid PostgreSQL-only constructs directly in business models. When database-specific behavior is required, encapsulate it in `api/models/types.py` using both PostgreSQL and MySQL dialect implementations, then consume that abstraction from model code.
- Suggested fix:
  - Do not directly place dialect-only types/operators in model columns when a portable wrapper can be used.
  - Add or extend wrappers in `models.types` (for example, `AdjustedJSON`, `LongText`, `BinaryData`) to normalize behavior across PostgreSQL and MySQL.
- Example:
  - Bad:
    ```python
    from sqlalchemy.dialects.postgresql import JSONB
    from sqlalchemy.orm import Mapped

    class ToolConfig(TypeBase):
        __tablename__ = "tool_configs"
        config: Mapped[dict] = mapped_column(JSONB, nullable=False)
    ```
  - Good:
    ```python
    from sqlalchemy.orm import Mapped

    from models.types import AdjustedJSON

    class ToolConfig(TypeBase):
        __tablename__ = "tool_configs"
        config: Mapped[dict] = mapped_column(AdjustedJSON(), nullable=False)
    ```

### Guard migration incompatibilities with dialect checks and shared types
- Category: maintainability
- Severity: critical
- Description: Migration scripts under `api/migrations/versions/` must account for PostgreSQL/MySQL incompatibilities explicitly. For dialect-sensitive DDL or defaults, branch on the active dialect (for example, `conn.dialect.name == "postgresql"`), and prefer reusable compatibility abstractions from `models.types` where applicable.
- Suggested fix:
  - In migration upgrades/downgrades, bind connection and branch by dialect for incompatible SQL fragments.
  - Reuse `models.types` wrappers in column definitions when that keeps behavior aligned with runtime models.
  - Avoid one-dialect-only migration logic unless there is a documented, deliberate compatibility exception.
- Example:
  - Bad:
    ```python
    with op.batch_alter_table("dataset_keyword_tables") as batch_op:
        batch_op.add_column(
            sa.Column(
                "data_source_type",
                sa.String(255),
                server_default=sa.text("'database'::character varying"),
                nullable=False,
            )
        )
    ```
  - Good:
    ```python
    def _is_pg(conn) -> bool:
        return conn.dialect.name == "postgresql"


    conn = op.get_bind()
    default_expr = sa.text("'database'::character varying") if _is_pg(conn) else sa.text("'database'")

    with op.batch_alter_table("dataset_keyword_tables") as batch_op:
        batch_op.add_column(
            sa.Column("data_source_type", sa.String(255), server_default=default_expr, nullable=False)
        )
    ```
