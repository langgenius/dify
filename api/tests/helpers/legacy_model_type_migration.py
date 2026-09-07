from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import uuid4

import sqlalchemy as sa
from sqlalchemy.engine import Engine

from models.account import Tenant
from models.enums import CredentialSourceType
from models.provider import (
    LoadBalancingModelConfig,
    ProviderModel,
    ProviderModelCredential,
    ProviderModelSetting,
    TenantDefaultModel,
)

LEGACY_TO_CANONICAL: dict[str, str] = {
    "text-generation": "llm",
    "embeddings": "text-embedding",
    "reranking": "rerank",
}
UNCHANGED_MODEL_TYPES: tuple[str, ...] = ("speech2text", "moderation", "tts")
ALL_TABLE_NAMES: tuple[str, ...] = (
    ProviderModel.__tablename__,
    TenantDefaultModel.__tablename__,
    ProviderModelSetting.__tablename__,
    LoadBalancingModelConfig.__tablename__,
    ProviderModelCredential.__tablename__,
)
DEFAULT_PRIMARY_TENANT_ID = "00000000-0000-0000-0000-000000000101"
DEFAULT_SECONDARY_TENANT_ID = "00000000-0000-0000-0000-000000000202"


@dataclass(frozen=True, slots=True)
class DirtyTenantFixture:
    tenant_id: str
    winner_credential_id: str
    loser_credential_id: str
    distinct_credential_id: str
    provider_model_id: str
    load_balancing_config_id: str
    provider_model_setting_id: str
    tenant_default_model_id: str
    embedding_provider_model_id: str
    embedding_setting_id: str
    loser_credential_name: str
    distinct_credential_name: str
    loser_encrypted_config: str
    winner_encrypted_config: str


@dataclass(frozen=True, slots=True)
class DirtyDataFixture:
    primary: DirtyTenantFixture
    secondary: DirtyTenantFixture


def create_minimal_legacy_model_type_schema(engine: Engine) -> None:
    metadata = Tenant.__table__.metadata
    metadata.create_all(
        engine,
        tables=[
            Tenant.__table__,
            ProviderModel.__table__,
            TenantDefaultModel.__table__,
            ProviderModelSetting.__table__,
            LoadBalancingModelConfig.__table__,
            ProviderModelCredential.__table__,
        ],
        checkfirst=True,
    )


def drop_minimal_legacy_model_type_schema(engine: Engine) -> None:
    metadata = Tenant.__table__.metadata
    metadata.drop_all(
        engine,
        tables=[
            LoadBalancingModelConfig.__table__,
            ProviderModelSetting.__table__,
            TenantDefaultModel.__table__,
            ProviderModel.__table__,
            ProviderModelCredential.__table__,
            Tenant.__table__,
        ],
        checkfirst=True,
    )


def seed_legacy_model_type_dirty_data(
    engine: Engine,
    *,
    primary_tenant_id: str = DEFAULT_PRIMARY_TENANT_ID,
    secondary_tenant_id: str = DEFAULT_SECONDARY_TENANT_ID,
) -> DirtyDataFixture:
    create_minimal_legacy_model_type_schema(engine)
    primary = _seed_tenant(engine, tenant_id=primary_tenant_id, provider_name="openai")
    secondary = _seed_tenant(engine, tenant_id=secondary_tenant_id, provider_name="openai")
    return DirtyDataFixture(primary=primary, secondary=secondary)


def snapshot_legacy_model_type_state(engine: Engine) -> dict[str, list[dict[str, object]]]:
    snapshots: dict[str, list[dict[str, object]]] = {}
    for table_name in ALL_TABLE_NAMES:
        snapshots[table_name] = fetch_table_rows(engine, table_name)
    return snapshots


def fetch_table_rows(
    engine: Engine,
    table_name: str,
    *,
    tenant_id: str | None = None,
) -> list[dict[str, object]]:
    sql = f"SELECT * FROM {table_name}"
    params: dict[str, object] = {}
    if tenant_id is not None:
        sql += " WHERE tenant_id = :tenant_id"
        params["tenant_id"] = tenant_id
    sql += " ORDER BY id ASC"

    with engine.begin() as conn:
        rows = conn.execute(sa.text(sql), params).mappings().all()

    result: list[dict[str, object]] = []
    for row in rows:
        normalized = dict(row)
        for key, value in normalized.items():
            match value:
                case datetime():
                    normalized[key] = value.isoformat()
                case uuid.UUID():
                    normalized[key] = str(value)
        result.append(normalized)
    return result


def fetch_model_types_for_tenant(engine: Engine, table_name: str, tenant_id: str) -> list[str]:
    rows = fetch_table_rows(engine, table_name, tenant_id=tenant_id)
    return [str(row["model_type"]) for row in rows]


def assert_tenant_rows_use_only_canonical_model_types(engine: Engine, tenant_id: str) -> None:
    for table_name in ALL_TABLE_NAMES:
        model_types = fetch_model_types_for_tenant(engine, table_name, tenant_id)
        assert set(model_types) <= set(LEGACY_TO_CANONICAL.values()) | set(UNCHANGED_MODEL_TYPES), (
            table_name,
            model_types,
        )


def count_rows(engine: Engine, table_name: str, *, tenant_id: str) -> int:
    with engine.begin() as conn:
        stmt = sa.text(f"SELECT COUNT(*) FROM {table_name} WHERE tenant_id = :tenant_id")
        return int(conn.execute(stmt, {"tenant_id": tenant_id}).scalar_one())


def _seed_tenant(engine: Engine, *, tenant_id: str, provider_name: str) -> DirtyTenantFixture:
    now = datetime(2025, 1, 1, 12, 0, 0)
    winner_credential_id = str(uuid4())
    loser_credential_id = str(uuid4())
    distinct_credential_id = str(uuid4())
    provider_model_id = str(uuid4())
    load_balancing_config_id = str(uuid4())
    provider_model_setting_id = str(uuid4())
    tenant_default_model_id = str(uuid4())
    embedding_provider_model_id = str(uuid4())
    embedding_setting_id = str(uuid4())

    loser_credential_name = f"{tenant_id}-shared"
    distinct_credential_name = f"{tenant_id}-distinct"
    winner_encrypted_config = json.dumps({"api_key": f"{tenant_id}-winner"})
    loser_encrypted_config = json.dumps({"api_key": f"{tenant_id}-loser"})
    distinct_encrypted_config = json.dumps({"api_key": f"{tenant_id}-distinct"})

    with engine.begin() as conn:
        conn.execute(
            Tenant.__table__.insert().values(
                id=tenant_id,
                name=f"Tenant {tenant_id}",
                plan="basic",
                status="normal",
            )
        )
        conn.execute(
            sa.text(
                """
                INSERT INTO provider_model_credentials
                    (
                        id, tenant_id, provider_name, model_name,
                        model_type, credential_name, encrypted_config,
                        created_at, updated_at
                    )
                VALUES
                    (
                        :winner_id, :tenant_id, :provider_name, 'gpt-4o-mini',
                        'llm', :shared_name, :winner_config,
                        :created_at, :winner_updated_at
                    ),
                    (
                        :loser_id, :tenant_id, :provider_name, 'gpt-4o-mini',
                        'text-generation', :shared_name, :loser_config,
                        :created_at, :loser_updated_at
                    ),
                    (
                        :distinct_id, :tenant_id, :provider_name, 'gpt-4o-mini',
                        'text-generation', :distinct_name, :distinct_config,
                        :created_at, :distinct_updated_at
                    )
                """
            ),
            {
                "winner_id": winner_credential_id,
                "loser_id": loser_credential_id,
                "distinct_id": distinct_credential_id,
                "tenant_id": tenant_id,
                "provider_name": provider_name,
                "shared_name": loser_credential_name,
                "distinct_name": distinct_credential_name,
                "winner_config": winner_encrypted_config,
                "loser_config": loser_encrypted_config,
                "distinct_config": distinct_encrypted_config,
                "created_at": now - timedelta(days=2),
                "winner_updated_at": now,
                "loser_updated_at": now - timedelta(days=1),
                "distinct_updated_at": now - timedelta(hours=12),
            },
        )
        conn.execute(
            sa.text(
                """
                INSERT INTO provider_models
                    (
                        id, tenant_id, provider_name, model_name,
                        model_type, credential_id, is_valid,
                        created_at, updated_at
                    )
                VALUES
                    (
                        :provider_model_id, :tenant_id, :provider_name, 'gpt-4o-mini',
                        'text-generation', :loser_id, :is_valid,
                        :created_at, :updated_at
                    ),
                    (
                        :embedding_provider_model_id, :tenant_id, :provider_name, 'text-embedding-3-large',
                        'embeddings', NULL, :is_valid,
                        :created_at, :updated_at
                    )
                """
            ),
            {
                "provider_model_id": provider_model_id,
                "embedding_provider_model_id": embedding_provider_model_id,
                "tenant_id": tenant_id,
                "provider_name": provider_name,
                "loser_id": loser_credential_id,
                "is_valid": True,
                "created_at": now - timedelta(days=2),
                "updated_at": now - timedelta(hours=6),
            },
        )
        conn.execute(
            sa.text(
                """
                INSERT INTO tenant_default_models
                    (id, tenant_id, provider_name, model_name, model_type, created_at, updated_at)
                VALUES
                    (
                        :tenant_default_model_id, :tenant_id, :provider_name, 'gpt-4o-mini',
                        'text-generation', :created_at, :updated_at
                    )
                """
            ),
            {
                "tenant_default_model_id": tenant_default_model_id,
                "tenant_id": tenant_id,
                "provider_name": provider_name,
                "created_at": now - timedelta(days=2),
                "updated_at": now - timedelta(hours=4),
            },
        )
        conn.execute(
            sa.text(
                """
                INSERT INTO provider_model_settings
                    (
                        id, tenant_id, provider_name, model_name,
                        model_type, enabled, load_balancing_enabled,
                        created_at, updated_at
                    )
                VALUES
                    (
                        :provider_model_setting_id, :tenant_id, :provider_name, 'gpt-4o-mini',
                        'text-generation', :enabled, :load_balancing_enabled,
                        :created_at, :updated_at
                    ),
                    (
                        :embedding_setting_id, :tenant_id, :provider_name, 'text-embedding-3-large',
                        'embeddings', :enabled, :embedding_load_balancing_enabled,
                        :created_at, :updated_at
                    )
                """
            ),
            {
                "provider_model_setting_id": provider_model_setting_id,
                "embedding_setting_id": embedding_setting_id,
                "tenant_id": tenant_id,
                "provider_name": provider_name,
                "enabled": True,
                "load_balancing_enabled": True,
                "embedding_load_balancing_enabled": False,
                "created_at": now - timedelta(days=2),
                "updated_at": now - timedelta(hours=3),
            },
        )
        conn.execute(
            sa.text(
                """
                INSERT INTO load_balancing_model_configs
                    (
                        id, tenant_id, provider_name, model_name, model_type,
                        name, encrypted_config, credential_id, credential_source_type,
                        enabled, created_at, updated_at
                    )
                VALUES
                    (
                        :load_balancing_config_id, :tenant_id, :provider_name, 'gpt-4o-mini', 'text-generation',
                        :lb_name, :loser_config, :loser_id, :credential_source_type,
                        :enabled, :created_at, :updated_at
                    )
                """
            ),
            {
                "load_balancing_config_id": load_balancing_config_id,
                "tenant_id": tenant_id,
                "provider_name": provider_name,
                "lb_name": loser_credential_name,
                "loser_config": loser_encrypted_config,
                "loser_id": loser_credential_id,
                "credential_source_type": CredentialSourceType.CUSTOM_MODEL.value,
                "enabled": True,
                "created_at": now - timedelta(days=2),
                "updated_at": now - timedelta(hours=2),
            },
        )

    return DirtyTenantFixture(
        tenant_id=tenant_id,
        winner_credential_id=winner_credential_id,
        loser_credential_id=loser_credential_id,
        distinct_credential_id=distinct_credential_id,
        provider_model_id=provider_model_id,
        load_balancing_config_id=load_balancing_config_id,
        provider_model_setting_id=provider_model_setting_id,
        tenant_default_model_id=tenant_default_model_id,
        embedding_provider_model_id=embedding_provider_model_id,
        embedding_setting_id=embedding_setting_id,
        loser_credential_name=loser_credential_name,
        distinct_credential_name=distinct_credential_name,
        loser_encrypted_config=loser_encrypted_config,
        winner_encrypted_config=winner_encrypted_config,
    )
