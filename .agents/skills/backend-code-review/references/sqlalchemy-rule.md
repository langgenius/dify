# Rule Catalog — SQLAlchemy Patterns

## Scope
- Covers: SQLAlchemy session and transaction lifecycle, query construction, tenant scoping, raw SQL boundaries, and write-path concurrency safeguards.
- Does NOT cover: table/model schema and migration design details (handled by `db-schema-rule.md`).

## Rules

### Use Session context manager with explicit transaction control behavior
- Category: best practices
- Severity: critical
- Description: Session and transaction lifecycle must be explicit and bounded on write paths. Missing commits can silently drop intended updates, while ad-hoc or long-lived transactions increase contention, lock duration, and deadlock risk.
- Suggested fix:
  - Use **explicit `session.commit()`** after completing a related write unit.
  - Or use **`session.begin()` context manager** for automatic commit/rollback on a scoped block.
  - Keep transaction windows short: avoid network I/O, heavy computation, or unrelated work inside the transaction.
- Example:
  - Bad:
    ```python
    # Missing commit: write may never be persisted.
    with Session(db.engine, expire_on_commit=False) as session:
        run = session.get(WorkflowRun, run_id)
        run.status = "cancelled"

    # Long transaction: external I/O inside a DB transaction.
    with Session(db.engine, expire_on_commit=False) as session, session.begin():
        run = session.get(WorkflowRun, run_id)
        run.status = "cancelled"
        call_external_api()
    ```
  - Good:
    ```python
    # Option 1: explicit commit.
    with Session(db.engine, expire_on_commit=False) as session:
        run = session.get(WorkflowRun, run_id)
        run.status = "cancelled"
        session.commit()

    # Option 2: scoped transaction with automatic commit/rollback.
    with Session(db.engine, expire_on_commit=False) as session, session.begin():
        run = session.get(WorkflowRun, run_id)
        run.status = "cancelled"

    # Keep non-DB work outside transaction scope.
    call_external_api()
    ```

### Enforce tenant_id scoping on shared-resource queries
- Category: security
- Severity: critical
- Description: Reads and writes against shared tables must be scoped by `tenant_id` to prevent cross-tenant data leakage or corruption.
- Suggested fix: Add `tenant_id` predicate to all tenant-owned entity queries and propagate tenant context through service/repository interfaces.
- Example:
  - Bad:
    ```python
    stmt = select(Workflow).where(Workflow.id == workflow_id)
    workflow = session.execute(stmt).scalar_one_or_none()
    ```
  - Good:
    ```python
    stmt = select(Workflow).where(
        Workflow.id == workflow_id,
        Workflow.tenant_id == tenant_id,
    )
    workflow = session.execute(stmt).scalar_one_or_none()
    ```

### Prefer SQLAlchemy expressions over raw SQL by default
- Category: maintainability
- Severity: suggestion
- Description: Raw SQL should be exceptional. ORM/Core expressions are easier to evolve, safer to compose, and more consistent with the codebase.
- Suggested fix: Rewrite straightforward raw SQL into SQLAlchemy `select/update/delete` expressions; keep raw SQL only when required by clear technical constraints.
- Example:
  - Bad:
    ```python
    row = session.execute(
        text("SELECT * FROM workflows WHERE id = :id AND tenant_id = :tenant_id"),
        {"id": workflow_id, "tenant_id": tenant_id},
    ).first()
    ```
  - Good:
    ```python
    stmt = select(Workflow).where(
        Workflow.id == workflow_id,
        Workflow.tenant_id == tenant_id,
    )
    row = session.execute(stmt).scalar_one_or_none()
    ```

### Protect write paths with concurrency safeguards
- Category: quality
- Severity: critical
- Description: Multi-writer paths without explicit concurrency control can silently overwrite data. Choose the safeguard based on contention level, lock scope, and throughput cost instead of defaulting to one strategy.
- Suggested fix:
  - **Optimistic locking**: Use when contention is usually low and retries are acceptable. Add a version (or updated_at) guard in `WHERE` and treat `rowcount == 0` as a conflict.
  - **Redis distributed lock**: Use when the critical section spans multiple steps/processes (or includes non-DB side effects) and you need cross-worker mutual exclusion.
  - **SELECT ... FOR UPDATE**: Use when contention is high on the same rows and strict in-transaction serialization is required. Keep transactions short to reduce lock wait/deadlock risk.
  - In all cases, scope by `tenant_id` and verify affected row counts for conditional writes.
- Example:
  - Bad:
    ```python
    # No tenant scope, no conflict detection, and no lock on a contested write path.
    session.execute(update(WorkflowRun).where(WorkflowRun.id == run_id).values(status="cancelled"))
    session.commit()  # silently overwrites concurrent updates
    ```
  - Good:
    ```python
    # 1) Optimistic lock (low contention, retry on conflict)
    result = session.execute(
        update(WorkflowRun)
        .where(
            WorkflowRun.id == run_id,
            WorkflowRun.tenant_id == tenant_id,
            WorkflowRun.version == expected_version,
        )
        .values(status="cancelled", version=WorkflowRun.version + 1)
    )
    if result.rowcount == 0:
        raise WorkflowStateConflictError("stale version, retry")

    # 2) Redis distributed lock (cross-worker critical section)
    lock_name = f"workflow_run_lock:{tenant_id}:{run_id}"
    with redis_client.lock(lock_name, timeout=20):
        session.execute(
            update(WorkflowRun)
            .where(WorkflowRun.id == run_id, WorkflowRun.tenant_id == tenant_id)
            .values(status="cancelled")
        )
        session.commit()

    # 3) Pessimistic lock with SELECT ... FOR UPDATE (high contention)
    run = session.execute(
        select(WorkflowRun)
        .where(WorkflowRun.id == run_id, WorkflowRun.tenant_id == tenant_id)
        .with_for_update()
    ).scalar_one()
    run.status = "cancelled"
    session.commit()
    ```