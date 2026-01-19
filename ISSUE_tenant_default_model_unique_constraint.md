# Title

fix: TenantDefaultModel table missing unique constraint causes system model settings to be lost after refresh

---

# Self Checks

- [x] I have read the Contributing Guide and Language Policy.
- [x] I have searched for existing issues search for existing issues, including closed ones.
- [x] I confirm that I am using English to submit this report, otherwise it will be closed.
- [x] Please do not modify this template :) and fill in all the required fields.

---

# 1. Is this request related to a challenge you're experiencing? Tell me about your story.

When using the "System Model Settings" page to configure default models (LLM, Embedding, Rerank), the saved configuration appears to be lost after refreshing the page.

**Root Cause Analysis:**

The `tenant_default_models` table is missing a unique constraint on `(tenant_id, model_type)`. This causes:

1. **Race condition on concurrent saves**: The code uses a "check-then-insert" pattern without proper locking:

```python
# provider_manager.py - update_default_model_record()
default_model = db.session.scalar(stmt)  # Check
if default_model:
    # Update existing
else:
    # Create new  <-- Race condition here!
```

2. **Duplicate records**: When multiple requests happen concurrently (or due to retry logic), duplicate records with the same `tenant_id` and `model_type` are inserted.

3. **Non-deterministic query results**: When duplicates exist, `db.session.scalar()` returns an arbitrary record, causing inconsistent display.

**Evidence:**

Database had multiple records for the same `(tenant_id, model_type)`:

```
tenant_id=03e5c3ed..., type=llm, model=ernie-4.0-turbo-128k
tenant_id=03e5c3ed..., type=llm, model=ernie-3.5-128k    <- duplicate!
tenant_id=03e5c3ed..., type=llm, model=ernie-3.5-128k    <- duplicate!
```

---

# 2. Additional context or comments

**Proposed Solution:**

1. Add `UniqueConstraint("tenant_id", "model_type")` to `TenantDefaultModel` model definition in `api/models/provider.py`

2. Create a database migration that:
   - Cleans up existing duplicate records (keeps the most recent one per `tenant_id + model_type`)
   - Adds the unique constraint

**Files to modify:**

| File | Change |
|------|--------|
| `api/models/provider.py` | Add unique constraint to model definition |
| `api/migrations/versions/xxx.py` | New migration file |

**Model change:**

```python
# Before
class TenantDefaultModel(TypeBase):
    __tablename__ = "tenant_default_models"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="tenant_default_model_pkey"),
        sa.Index("tenant_default_model_tenant_id_provider_type_idx", "tenant_id", "provider_name", "model_type"),
    )

# After
class TenantDefaultModel(TypeBase):
    __tablename__ = "tenant_default_models"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="tenant_default_model_pkey"),
        sa.Index("tenant_default_model_tenant_id_provider_type_idx", "tenant_id", "provider_name", "model_type"),
        sa.UniqueConstraint("tenant_id", "model_type", name="unique_tenant_default_model_type"),  # Added
    )
```

**Migration SQL logic:**

```sql
-- Clean duplicates first
DELETE FROM tenant_default_models
WHERE id NOT IN (
    SELECT DISTINCT ON (tenant_id, model_type) id
    FROM tenant_default_models
    ORDER BY tenant_id, model_type, updated_at DESC
);

-- Then add constraint
ALTER TABLE tenant_default_models 
ADD CONSTRAINT unique_tenant_default_model_type UNIQUE (tenant_id, model_type);
```

---

# 3. Can you help us with this feature?

- [x] I am interested in contributing to this feature.

I have already implemented the fix locally and verified it works. Ready to submit a PR.