"""PostgreSQL Builder origin backfill shared by the End User revision and rollout cutover."""

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from migrations.postgresql_online_v1 import nullable_column_exists

ORIGIN_COLUMN = "first_workspace_created_at"

# DO runs outside a transaction so each COMMIT releases the batch's row locks.
# A keyset scan also advances over accounts that correctly have no origin.
POSTGRES_BACKFILL = sa.text("""
DO $builder_origin$
DECLARE
    upper_id uuid;
    after_id uuid;
    batch_ids uuid[];
BEGIN
    SELECT id INTO upper_id FROM accounts ORDER BY id DESC LIMIT 1;
    LOOP
        IF after_id IS NULL THEN
            SELECT ARRAY(
                SELECT id FROM accounts
                WHERE id <= upper_id AND first_workspace_created_at IS NULL
                ORDER BY id LIMIT 1000
            ) INTO batch_ids;
        ELSE
            SELECT ARRAY(
                SELECT id FROM accounts
                WHERE id > after_id AND id <= upper_id AND first_workspace_created_at IS NULL
                ORDER BY id LIMIT 1000
            ) INTO batch_ids;
        END IF;
        EXIT WHEN cardinality(batch_ids) = 0;

        WITH origins AS (
            SELECT account.id, COALESCE(
                (
                    SELECT min(workspace.created_at)
                    FROM tenant_account_joins AS membership
                    JOIN tenants AS workspace ON workspace.id = membership.tenant_id
                    WHERE membership.account_id = account.id AND membership.role = 'owner'
                ),
                CASE WHEN account.status = 'active' THEN COALESCE(account.initialized_at, account.created_at)
                     ELSE account.initialized_at END
            ) AS origin
            FROM accounts AS account
            WHERE account.id = ANY(batch_ids) AND account.first_workspace_created_at IS NULL
        )
        UPDATE accounts AS account
        SET first_workspace_created_at = origins.origin
        FROM origins
        WHERE account.id = origins.id AND account.first_workspace_created_at IS NULL AND origins.origin IS NOT NULL;

        after_id := batch_ids[cardinality(batch_ids)];
        COMMIT;
    END LOOP;
END;
$builder_origin$
""")


def backfill_at_cutover(bind: Connection) -> None:
    """Fill delayed legacy rows after legacy writers stop and before new writers start.

    Require a fresh PostgreSQL connection and the expanded schema. Do not run
    after the new onboarding flow writes accounts: its intentional NULLs are
    not legacy origins. Retries preserve origins already recorded; failures
    leave any committed batches intact.
    """
    if bind.dialect.name != "postgresql":
        raise ValueError("The staged Builder origin backfill requires PostgreSQL")
    bind.execution_options(isolation_level="AUTOCOMMIT")
    if not nullable_column_exists(bind, "accounts", ORIGIN_COLUMN, sa.DateTime()):
        raise RuntimeError(f"Run the schema upgrade before backfilling accounts.{ORIGIN_COLUMN}")
    bind.execute(POSTGRES_BACKFILL)
