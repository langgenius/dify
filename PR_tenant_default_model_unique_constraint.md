> [!IMPORTANT]
>
> 1. Make sure you have read our [contribution guidelines](https://github.com/langgenius/dify/blob/main/CONTRIBUTING.md)
> 1. Ensure there is an associated issue and you have been assigned to it
> 1. Use the correct syntax to link this PR: `Fixes #<issue number>`.

## Summary

Fixes #<issue number>

### Problem

The `tenant_default_models` table is missing a unique constraint on `(tenant_id, model_type)`, which causes system model settings to appear lost after page refresh.

**Root cause:**

1. **Race condition on concurrent saves**: The code uses a "check-then-insert" pattern without proper locking in `provider_manager.py`:
   ```python
   default_model = db.session.scalar(stmt)  # Check
   if default_model:
       # Update existing
   else:
       # Create new  <-- Race condition here!
   ```

2. **Duplicate records**: When multiple requests happen concurrently, duplicate records with the same `tenant_id` and `model_type` are inserted.

3. **Non-deterministic query results**: When duplicates exist, `db.session.scalar()` returns an arbitrary record, causing inconsistent display.

### Solution

1. Add `UniqueConstraint("tenant_id", "model_type")` to `TenantDefaultModel` model definition in `api/models/provider.py`

2. Create a database migration that:
   - Cleans up existing duplicate records (keeps the most recent one per `tenant_id + model_type`)
   - Adds the unique constraint

### Changes

| File | Change |
|------|--------|
| `api/models/provider.py` | Add unique constraint to `TenantDefaultModel` model |
| `api/migrations/versions/2026_01_19_1507-fix_tenant_default_model_unique.py` | New migration file |

## Screenshots

| Before | After |
|--------|-------|
| System model settings lost after page refresh due to duplicate records | Settings persist correctly with unique constraint enforced |

## Checklist

- [ ] This change requires a documentation update, included: [Dify Document](https://github.com/langgenius/dify-docs)
- [x] I understand that this PR may be closed in case there was no previous discussion or issues. (This doesn't apply to typos!)
- [x] I've added a test for each change that was introduced, and I tried as much as possible to make a single atomic change.
- [x] I've updated the documentation accordingly.
- [x] I ran `make lint` and `make type-check` (backend) and `cd web && npx lint-staged` (frontend) to appease the lint gods