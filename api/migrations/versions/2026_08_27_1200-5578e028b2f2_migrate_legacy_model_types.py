"""migrate legacy model types

Revision ID: 5578e028b2f2
Revises: 9b7c6d5e4f3a
Create Date: 2026-08-27 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "5578e028b2f2"
down_revision = "9b7c6d5e4f3a"
branch_labels = None
depends_on = None

_AFFECTED_TABLES = (
    "provider_models",
    "provider_model_credentials",
    "tenant_default_models",
    "provider_model_settings",
    "load_balancing_model_configs",
)
_LEGACY_MODEL_TYPES = ("text-generation", "embeddings", "reranking")
_MAPPED_MODEL_TYPES = (
    "text-generation",
    "llm",
    "embeddings",
    "text-embedding",
    "reranking",
    "rerank",
)
_CREDENTIAL_MERGES_TABLE = "tmp_5578e028b2f2_credential_merges"


def _canonical_model_type(alias: str) -> str:
    return f"""CASE {alias}.model_type
        WHEN 'text-generation' THEN 'llm'
        WHEN 'embeddings' THEN 'text-embedding'
        WHEN 'reranking' THEN 'rerank'
        ELSE {alias}.model_type
    END"""


def _mapped_model_types_sql() -> str:
    return ", ".join(f"'{model_type}'" for model_type in _MAPPED_MODEL_TYPES)


def _legacy_model_types_sql() -> str:
    return ", ".join(f"'{model_type}'" for model_type in _LEGACY_MODEL_TYPES)


def _same_business_key(left_alias: str, right_alias: str, key_columns: tuple[str, ...]) -> str:
    key_condition = "\n        AND ".join(f"{left_alias}.{column} = {right_alias}.{column}" for column in key_columns)
    return f"""{key_condition}
        AND {_canonical_model_type(left_alias)} = {_canonical_model_type(right_alias)}"""


def _delete_duplicates(
    table_name: str,
    key_columns: tuple[str, ...],
    *,
    extra_condition: str | None = None,
    require_legacy_row: bool = True,
) -> None:
    dialect_name = op.get_context().dialect.name
    scoped_condition = f"\n        AND {extra_condition}" if extra_condition else ""
    common_condition = f"""{_same_business_key("loser", "winner", key_columns)}
        AND loser.model_type IN ({_mapped_model_types_sql()})
        AND winner.model_type IN ({_mapped_model_types_sql()})
        AND (
            loser.updated_at < winner.updated_at
            OR (loser.updated_at = winner.updated_at AND loser.id < winner.id)
        ){scoped_condition}"""
    legacy_table = f", {table_name} AS legacy" if require_legacy_row else ""
    legacy_join = ""
    if require_legacy_row:
        legacy_join = f"""
        AND {_same_business_key("loser", "legacy", key_columns)}
        AND legacy.model_type IN ({_legacy_model_types_sql()})"""

    if dialect_name == "postgresql":
        op.execute(
            sa.text(
                f"""DELETE FROM {table_name} AS loser
                USING {table_name} AS winner{legacy_table}
                WHERE {common_condition}{legacy_join}"""
            )
        )
        return

    if dialect_name in {"mysql", "mariadb"}:
        legacy_table = ""
        if require_legacy_row:
            legacy_table = f"""
                INNER JOIN {table_name} AS legacy
                    ON {_same_business_key("loser", "legacy", key_columns)}
                    AND legacy.model_type IN ({_legacy_model_types_sql()})"""
        op.execute(
            sa.text(
                f"""DELETE loser
                FROM {table_name} AS loser
                INNER JOIN {table_name} AS winner
                    ON {common_condition}{legacy_table}"""
            )
        )
        return

    raise RuntimeError(f"unsupported database dialect: {dialect_name}")


def _create_credential_merges() -> None:
    dialect_name = op.get_context().dialect.name
    if dialect_name == "postgresql":
        table_options = "ON COMMIT DROP"
    elif dialect_name in {"mysql", "mariadb"}:
        # MySQL does not roll back temporary-table DDL. Remove a table left by
        # an in-process retry without risking a permanent table of the same name.
        op.execute(sa.text(f"DROP TEMPORARY TABLE IF EXISTS {_CREDENTIAL_MERGES_TABLE}"))
        table_options = ""
    else:
        raise RuntimeError(f"unsupported database dialect: {dialect_name}")

    op.execute(
        sa.text(
            f"""CREATE TEMPORARY TABLE {_CREDENTIAL_MERGES_TABLE} {table_options} AS
            SELECT id AS loser_id, winner_id
            FROM (
                SELECT
                    id,
                    FIRST_VALUE(id) OVER (
                        PARTITION BY
                            tenant_id,
                            provider_name,
                            model_name,
                            credential_name,
                            {_canonical_model_type("provider_model_credentials")}
                        ORDER BY updated_at DESC, id DESC
                        ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
                    ) AS winner_id,
                    SUM(CASE WHEN model_type IN ({_legacy_model_types_sql()}) THEN 1 ELSE 0 END) OVER (
                        PARTITION BY
                            tenant_id,
                            provider_name,
                            model_name,
                            credential_name,
                            {_canonical_model_type("provider_model_credentials")}
                    ) AS legacy_count
                FROM provider_model_credentials
                WHERE model_type IN ({_mapped_model_types_sql()})
            ) AS ranked_credentials
            WHERE id <> winner_id AND legacy_count > 0"""
        )
    )


def _rewrite_credential_references() -> None:
    dialect_name = op.get_context().dialect.name
    if dialect_name == "postgresql":
        op.execute(
            sa.text(
                f"""UPDATE provider_models AS model
                SET credential_id = merges.winner_id
                FROM {_CREDENTIAL_MERGES_TABLE} AS merges
                WHERE model.credential_id = merges.loser_id"""
            )
        )
        op.execute(
            sa.text(
                f"""UPDATE load_balancing_model_configs AS config
                SET
                    credential_id = merges.winner_id,
                    name = winner.credential_name,
                    encrypted_config = winner.encrypted_config
                FROM {_CREDENTIAL_MERGES_TABLE} AS merges
                INNER JOIN provider_model_credentials AS winner ON winner.id = merges.winner_id
                WHERE config.credential_id = merges.loser_id"""
            )
        )
        return

    if dialect_name in {"mysql", "mariadb"}:
        op.execute(
            sa.text(
                f"""UPDATE provider_models AS model
                INNER JOIN {_CREDENTIAL_MERGES_TABLE} AS merges ON model.credential_id = merges.loser_id
                SET model.credential_id = merges.winner_id"""
            )
        )
        op.execute(
            sa.text(
                f"""UPDATE load_balancing_model_configs AS config
                INNER JOIN {_CREDENTIAL_MERGES_TABLE} AS merges ON config.credential_id = merges.loser_id
                INNER JOIN provider_model_credentials AS winner ON winner.id = merges.winner_id
                SET
                    config.credential_id = merges.winner_id,
                    config.name = winner.credential_name,
                    config.encrypted_config = winner.encrypted_config"""
            )
        )
        return

    raise RuntimeError(f"unsupported database dialect: {dialect_name}")


def _delete_merged_credentials() -> None:
    dialect_name = op.get_context().dialect.name
    if dialect_name == "postgresql":
        op.execute(
            sa.text(
                f"""DELETE FROM provider_model_credentials AS credential
                USING {_CREDENTIAL_MERGES_TABLE} AS merges
                WHERE credential.id = merges.loser_id"""
            )
        )
        op.execute(sa.text(f"DROP TABLE {_CREDENTIAL_MERGES_TABLE}"))
        return

    if dialect_name in {"mysql", "mariadb"}:
        op.execute(
            sa.text(
                f"""DELETE credential
                FROM provider_model_credentials AS credential
                INNER JOIN {_CREDENTIAL_MERGES_TABLE} AS merges ON credential.id = merges.loser_id"""
            )
        )
        op.execute(sa.text(f"DROP TEMPORARY TABLE {_CREDENTIAL_MERGES_TABLE}"))
        return

    raise RuntimeError(f"unsupported database dialect: {dialect_name}")


def _canonicalize_model_types() -> None:
    for table_name in _AFFECTED_TABLES:
        op.execute(
            sa.text(
                f"""UPDATE {table_name}
                SET model_type = {_canonical_model_type(table_name)}
                WHERE model_type IN ('text-generation', 'embeddings', 'reranking')"""
            )
        )


def upgrade() -> None:
    # Preserve the established manual migration policy: the newest row wins
    # when legacy and canonical values collapse onto the same business key.
    _delete_duplicates("provider_models", ("tenant_id", "provider_name", "model_name"))
    _delete_duplicates("tenant_default_models", ("tenant_id",))
    _delete_duplicates("provider_model_settings", ("tenant_id", "provider_name", "model_name"))
    _delete_duplicates(
        "load_balancing_model_configs",
        ("tenant_id", "provider_name", "model_name"),
        extra_condition="loser.name = '__inherit__' AND winner.name = '__inherit__'",
        require_legacy_row=False,
    )

    _create_credential_merges()
    _rewrite_credential_references()
    _delete_merged_credentials()
    _canonicalize_model_types()


def downgrade() -> None:
    # Canonical rows created after the enum rename cannot be distinguished from
    # rows changed here, so reversing this data migration would corrupt valid data.
    pass
