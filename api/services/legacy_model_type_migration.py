"""
Migrate legacy provider-related model_type values to canonical values.

The grouped tables scan legacy candidates in id order, then reload the full business-key
group inside a transaction before deciding a winner row and the loser rows to delete.
Those grouped flows share the same dry-run/apply handling for group reloads, winner-loser
decisions, row updates, row deletes, and structured logging. Only some grouped tables
also add cache cleanup; that includes `provider_models` and
`provider_model_credentials`. Provider-model-credential groups extend that flow by
rewriting credential references in provider models and load-balancing configs before
removing loser credential rows. `load_balancing_model_configs` stays mostly row-level,
but it first deduplicates `name="__inherit__"` rows by business key before it
canonicalizes the remaining legacy rows independently with row-level cache cleanup.

Tenant scheduling has two modes. When callers provide an explicit tenant list, the
service preserves the original tenant-scoped execution model and runs all selected tables
for each tenant. When callers omit `tenant_ids`, the service discovers tenant
ids per table and then runs only that table for the discovered tenants. Most
tables keep the active `model_types` filter in the discovery query, while
`load_balancing_model_configs` deliberately uses a whole-table tenant scan so
that query stays easy to understand.
"""

from __future__ import annotations

import io
import json
import sys
import threading
import traceback
import uuid
from collections.abc import Iterable, Sequence
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from datetime import datetime
from enum import IntEnum, StrEnum
from typing import Protocol, cast, override

import sqlalchemy as sa
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session
from sqlalchemy.sql import select

from core.helper.model_provider_cache import ProviderCredentialsCache, ProviderCredentialsCacheType
from graphon.model_runtime.entities.model_entities import ModelType
from libs.datetime_utils import naive_utc_now
from models import LoadBalancingModelConfig, ProviderModel, ProviderModelSetting, TenantDefaultModel
from models.base import TypeBase
from models.provider import ProviderModelCredential

type ORMModel = type[TypeBase]


def _json_default(value: object) -> object:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, (IntEnum, StrEnum)):
        return value.value
    return value


def _normalize_log_value(field_name: str, value: object) -> object:
    if field_name == "encrypted_config" and isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


def _normalize_log_mapping(values: dict[str, object]) -> dict[str, object]:
    return {key: _normalize_log_value(key, value) for key, value in values.items()}


def _normalize_log_payload(value: object) -> object:
    if value is None or isinstance(value, bool | int | float | str):
        return value
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, (IntEnum, StrEnum)):
        return value.value
    if isinstance(value, dict):
        return {str(key): _normalize_log_payload(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_normalize_log_payload(item) for item in value]
    if isinstance(value, (set, frozenset)):
        normalized_items = [_normalize_log_payload(item) for item in value]
        return sorted(normalized_items, key=lambda item: json.dumps(item, sort_keys=True))

    table_name = getattr(value, "__tablename__", None)
    if isinstance(table_name, str):
        return table_name

    name = getattr(value, "name", None)
    if isinstance(name, str):
        return name

    table = getattr(value, "table", None)
    if table is not None:
        referenced_table_name = getattr(table, "name", None)
        if isinstance(referenced_table_name, str):
            return referenced_table_name

    return f"<{type(value).__module__}.{type(value).__qualname__}>"


def _format_exception_stacktrace(exc: BaseException) -> str:
    return "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))


@dataclass(frozen=True, slots=True)
class _RowWithRawModelType[T: TypeBase]:
    row: T
    raw_model_type: str
    canonical_model_type: ModelType


@dataclass(frozen=True, slots=True)
class _CacheDeletePlan:
    tenant_id: str
    identity_id: str
    cache_type: ProviderCredentialsCacheType
    table_name: str
    row_id: str
    tx_id: str
    business_key: _BusinessKey


@dataclass(frozen=True, slots=True)
class _BusinessKey:
    """Marker base type for structured migration business keys."""


class _HasRowId(Protocol):
    id: object


class _HasRowIdAndUpdatedAt(_HasRowId, Protocol):
    updated_at: datetime


def _normalize_error_code_string(value: object) -> str | None:
    if isinstance(value, str):
        normalized_value = value.strip().upper()
        return normalized_value or None
    return None


def _normalize_error_code_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        normalized_value = value.strip()
        if normalized_value.isdigit():
            return int(normalized_value)
    return None


@dataclass(frozen=True, slots=True)
class _ProviderModelBusinessKey(_BusinessKey):
    """unique index: unique_provider_model_name"""

    tenant_id: str
    provider_name: str
    model_name: str
    model_type: ModelType


@dataclass(frozen=True, slots=True)
class _TenantDefaultModelBusinessKey(_BusinessKey):
    """unique index: unique_tenant_default_model_type"""

    tenant_id: str
    model_type: ModelType


@dataclass(frozen=True, slots=True)
class _ProviderModelSettingBusinessKey(_BusinessKey):
    """Although `ProviderModelSetting` does not have the unique index
    (tenant_id, provider_name. model_name, model_type). The acutal business logic
    relies on this uniqueness property heavily.
    """

    tenant_id: str
    provider_name: str
    model_name: str
    model_type: ModelType


@dataclass(frozen=True, slots=True)
class _LoadBalancingModelConfigInheritBusinessKey(_BusinessKey):
    """Business key for `name="__inherit__"` load-balancing configs."""

    tenant_id: str
    provider_name: str
    model_name: str
    model_type: ModelType


@dataclass(frozen=True, slots=True)
class _ProviderModelCredentialBusinessKey(_BusinessKey):
    """Although `ProviderModelCredential` does not have the unique index
    (tenant_id, provider_name. model_name, model_type, credential_name).
    The acutal business logic implies it."""

    tenant_id: str
    provider_name: str
    model_name: str
    credential_name: str
    model_type: ModelType


@dataclass(frozen=True, slots=True)
class _ProviderModelGroupPlan:
    group_row_ids: list[str]
    winner: _RowWithRawModelType[ProviderModel] | None
    loser_rows: list[_RowWithRawModelType[ProviderModel]]


@dataclass(frozen=True, slots=True)
class _TenantDefaultModelGroupPlan:
    group_row_ids: list[str]
    winner: _RowWithRawModelType[TenantDefaultModel] | None
    loser_rows: list[_RowWithRawModelType[TenantDefaultModel]]


@dataclass(frozen=True, slots=True)
class _ProviderModelSettingGroupPlan:
    group_row_ids: list[str]
    winner: _RowWithRawModelType[ProviderModelSetting] | None
    loser_rows: list[_RowWithRawModelType[ProviderModelSetting]]


@dataclass(frozen=True, slots=True)
class _LoadBalancingModelConfigInheritGroupPlan:
    group_row_ids: list[str]
    winner: _RowWithRawModelType[LoadBalancingModelConfig] | None
    loser_rows: list[_RowWithRawModelType[LoadBalancingModelConfig]]


@dataclass(frozen=True, slots=True)
class _ProviderModelReferenceRewritePlan:
    row_id: str
    old_credential_id: str
    new_credential_id: str


@dataclass(frozen=True, slots=True)
class _LoadBalancingCredentialRewritePlan:
    row_id: str
    old_credential_id: str | None
    old_name: str
    old_encrypted_config: str | None
    new_credential_id: str
    new_name: str
    new_encrypted_config: str | None


@dataclass(frozen=True, slots=True)
class _ProviderModelCredentialGroupPlan:
    group_row_ids: list[str]
    winner: _RowWithRawModelType[ProviderModelCredential] | None
    loser_rows: list[_RowWithRawModelType[ProviderModelCredential]]
    provider_model_rewrites: list[_ProviderModelReferenceRewritePlan]
    load_balancing_rewrites: list[_LoadBalancingCredentialRewritePlan]


VALID_TABLE_NAMES: tuple[str, ...] = (
    ProviderModel.__tablename__,
    TenantDefaultModel.__tablename__,
    ProviderModelSetting.__tablename__,
    LoadBalancingModelConfig.__tablename__,
    ProviderModelCredential.__tablename__,
)

_SUPPORTED_MODEL_TYPES: tuple[ModelType, ...] = (
    ModelType.LLM,
    ModelType.TEXT_EMBEDDING,
    ModelType.RERANK,
)
_CANONICAL_TO_LEGACY: dict[ModelType, tuple[str, ...]] = {
    ModelType.LLM: ("text-generation",),
    ModelType.TEXT_EMBEDDING: ("embeddings",),
    ModelType.RERANK: ("reranking",),
}
_LEGACY_TO_CANONICAL: dict[str, ModelType] = {
    legacy_value: canonical_model_type
    for canonical_model_type, legacy_values in _CANONICAL_TO_LEGACY.items()
    for legacy_value in legacy_values
}
_POSTGRES_LOCK_TIMEOUT_SQLSTATES: frozenset[str] = frozenset({"55P03"})
_MYSQL_LOCK_TIMEOUT_ERRNOS: frozenset[int] = frozenset({1205})
_LOCK_TIMEOUT_FALLBACK_MESSAGES: tuple[str, ...] = (
    "canceling statement due to lock timeout",
    "lock wait timeout exceeded",
)
_RAW_MODEL_TYPE_COLUMN = "_raw_model_type"


def _selected_legacy_values(model_types: Sequence[ModelType]) -> list[str]:
    legacy_values: list[str] = []
    for model_type in model_types:
        legacy_values.extend(_CANONICAL_TO_LEGACY[model_type])
    return legacy_values


def _selected_model_type_values(model_types: Sequence[ModelType]) -> list[str]:
    model_type_values: list[str] = []
    for model_type in model_types:
        model_type_values.append(model_type.value)
        model_type_values.extend(_CANONICAL_TO_LEGACY[model_type])
    return list(dict.fromkeys(model_type_values))


def _session_factory(engine: sa.Engine) -> Session:
    return Session(bind=engine, expire_on_commit=False)


class _ThreadSafeLineWriter(io.TextIOBase):
    """
    Serialize line-oriented writes to a shared text stream across tenant workers.

    `Migration._log_event` writes one JSON document per `print(..., flush=True)` call. The
    wrapper buffers fragments per thread until a newline arrives, then emits the full line
    while holding a process-local lock so concurrent tenants cannot interleave bytes.
    """

    _stream: io.TextIOBase
    _lock: threading.Lock
    _local: threading.local

    def __init__(self, stream: io.TextIOBase) -> None:
        super().__init__()
        self._stream = stream
        self._lock = threading.Lock()
        self._local = threading.local()

    @override
    def writable(self) -> bool:
        return True

    @override
    def write(self, text: str) -> int:
        if not text:
            return 0

        buffered_text = self._buffer + text
        lines = buffered_text.splitlines(keepends=True)
        remainder = ""
        if lines and not lines[-1].endswith(("\n", "\r")):
            remainder = lines.pop()

        for line in lines:
            self._write_line(line)

        self._buffer = remainder
        return len(text)

    @override
    def flush(self) -> None:
        buffered_text = self._buffer
        if buffered_text:
            self._write_line(buffered_text)
            self._buffer = ""

        with self._lock:
            self._stream.flush()

    @property
    def _buffer(self) -> str:
        return cast(str, getattr(self._local, "buffer", ""))

    @_buffer.setter
    def _buffer(self, value: str) -> None:
        self._local.buffer = value

    def _write_line(self, text: str) -> None:
        with self._lock:
            self._stream.write(text)


class LegacyModelTypeMigrationService:
    """
    Migrate legacy provider-related model_type values to canonical values.

    The command can scope the migration by table, tenant, and canonical model type. When
    `provider_model_credentials` is selected, that migration also rewrites references in
    `provider_models` and `load_balancing_model_configs`. Tenant migrations can run in a
    thread pool; JSONL output remains line-safe through a shared synchronized writer.

    If `tenant_ids` is omitted, tenant discovery becomes table-scoped: each selected ORM
    model loads its own tenant ids, then only that table is dispatched for those tenants.
    Most tables keep the active model-type filter in discovery, while
    `load_balancing_model_configs` intentionally uses the whole table so the tenant query
    stays simple. This still avoids merging tenant ids across unrelated tables.
    """

    _engine: sa.Engine
    _apply: bool
    _concurrency: int
    _output: io.TextIOBase
    _model_types: tuple[ModelType, ...]
    _orm_models: tuple[ORMModel, ...]
    _tenant_ids: tuple[str, ...] | None

    def __init__(
        self,
        engine: sa.Engine,
        *,
        apply: bool = False,
        concurrency: int = 1,
        output: io.TextIOBase | None = None,
        tables: Sequence[str] | None = None,
        model_types: Sequence[ModelType] = _SUPPORTED_MODEL_TYPES,
        tenant_ids: Sequence[str] | None = None,
    ) -> None:
        if concurrency < 1:
            raise ValueError("concurrency must be greater than or equal to 1")

        self._engine = engine
        self._apply = apply
        self._concurrency = concurrency
        self._output = cast(io.TextIOBase, sys.stdout if output is None else output)
        self._model_types = tuple(dict.fromkeys(model_types))
        self._orm_models = self._resolve_models(tables)
        self._tenant_ids = tuple(dict.fromkeys(tenant_ids)) if tenant_ids is not None else None

    def _resolve_models(self, tables: Sequence[str] | None) -> tuple[ORMModel, ...]:
        if tables is None:
            return (
                ProviderModel,
                TenantDefaultModel,
                ProviderModelSetting,
                LoadBalancingModelConfig,
                ProviderModelCredential,
            )

        ordered_models: list[ORMModel] = []
        seen_tables: set[str] = set()
        for table_name in tables:
            if table_name in seen_tables:
                continue
            seen_tables.add(table_name)
            if table_name == ProviderModel.__tablename__:
                ordered_models.append(ProviderModel)
            elif table_name == TenantDefaultModel.__tablename__:
                ordered_models.append(TenantDefaultModel)
            elif table_name == ProviderModelSetting.__tablename__:
                ordered_models.append(ProviderModelSetting)
            elif table_name == LoadBalancingModelConfig.__tablename__:
                ordered_models.append(LoadBalancingModelConfig)
            elif table_name == ProviderModelCredential.__tablename__:
                ordered_models.append(ProviderModelCredential)
            else:
                raise ValueError(f"invalid table name: {table_name}")
        return tuple(ordered_models)

    def migrate(self) -> None:
        output = _ThreadSafeLineWriter(self._output)
        if self._tenant_ids is not None:
            self._migrate_explicit_tenants(output)
            return

        self._migrate_tables_with_discovered_tenants(output)

    def _migrate_explicit_tenants(self, output: io.TextIOBase) -> None:
        tenant_ids = self._tenant_ids
        if not tenant_ids:
            return

        self._run_migrations_for_tenants(tenant_ids, self._orm_models, output)

    def _migrate_tables_with_discovered_tenants(self, output: io.TextIOBase) -> None:
        for orm_model in self._orm_models:
            tenant_ids = self._load_tenant_ids_for_model(orm_model)
            if not tenant_ids:
                continue
            self._run_migrations_for_tenants(tenant_ids, (orm_model,), output)

    def _run_migrations_for_tenants(
        self,
        tenant_ids: Sequence[str],
        orm_models: Sequence[ORMModel],
        output: io.TextIOBase,
    ) -> None:
        if self._concurrency == 1 or len(tenant_ids) == 1:
            for tenant_id in tenant_ids:
                self._run_tenant_migration(tenant_id, orm_models, output)
            return

        with ThreadPoolExecutor(max_workers=min(self._concurrency, len(tenant_ids))) as executor:
            futures = [
                executor.submit(self._run_tenant_migration, tenant_id, orm_models, output) for tenant_id in tenant_ids
            ]
            for future in as_completed(futures):
                future.result()

    def _run_tenant_migration(
        self,
        tenant_id: str,
        orm_models: Sequence[ORMModel],
        output: io.TextIOBase,
    ) -> None:
        """
        Execute one tenant migration with the shared, line-synchronized output stream.
        """

        Migration(
            tenant_id=tenant_id,
            engine=self._engine,
            apply=self._apply,
            output=output,
            model_types=self._model_types,
            orm_models=orm_models,
        ).run()

    def _load_tenant_ids_for_model(self, orm_model: ORMModel) -> tuple[str, ...]:
        """
        Discover only the tenants that have candidate rows for the current table.

        In automatic tenant mode we keep discovery table-scoped so large shared tenant
        populations do not force empty work for unrelated tables. Most table queries
        still apply the active `model_types` filter before scheduling migrations, while
        `load_balancing_model_configs` intentionally trades a wider tenant set for a
        simpler discovery query.
        """

        legacy_model_type_values = _selected_legacy_values(self._model_types)
        with _session_factory(self._engine) as session:
            if orm_model is ProviderModel:
                tenant_ids = (
                    session.execute(
                        select(ProviderModel.tenant_id)
                        .where(sa.type_coerce(ProviderModel.model_type, sa.String()).in_(legacy_model_type_values))
                        .distinct()
                        .order_by(ProviderModel.tenant_id.asc())
                    )
                    .scalars()
                    .all()
                )
            elif orm_model is TenantDefaultModel:
                tenant_ids = (
                    session.execute(
                        select(TenantDefaultModel.tenant_id)
                        .where(sa.type_coerce(TenantDefaultModel.model_type, sa.String()).in_(legacy_model_type_values))
                        .distinct()
                        .order_by(TenantDefaultModel.tenant_id.asc())
                    )
                    .scalars()
                    .all()
                )
            elif orm_model is ProviderModelSetting:
                tenant_ids = (
                    session.execute(
                        select(ProviderModelSetting.tenant_id)
                        .where(
                            sa.type_coerce(ProviderModelSetting.model_type, sa.String()).in_(legacy_model_type_values)
                        )
                        .distinct()
                        .order_by(ProviderModelSetting.tenant_id.asc())
                    )
                    .scalars()
                    .all()
                )
            elif orm_model is LoadBalancingModelConfig:
                # Deliberately discover tenants from the whole table so the query stays
                # easier to understand than the legacy/canonical mixed-row filter.
                tenant_ids = (
                    session.execute(
                        select(LoadBalancingModelConfig.tenant_id)
                        .distinct()
                        .order_by(LoadBalancingModelConfig.tenant_id.asc())
                    )
                    .scalars()
                    .all()
                )
            elif orm_model is ProviderModelCredential:
                tenant_ids = (
                    session.execute(
                        select(ProviderModelCredential.tenant_id)
                        .where(
                            sa.type_coerce(ProviderModelCredential.model_type, sa.String()).in_(
                                legacy_model_type_values
                            )
                        )
                        .distinct()
                        .order_by(ProviderModelCredential.tenant_id.asc())
                    )
                    .scalars()
                    .all()
                )
            else:
                raise ValueError(f"unsupported orm model: {orm_model}")

        return tuple(tenant_ids)


class Migration:
    """
    Execute the migration for one tenant.

    The implementation is intentionally table-specific. Each table has its own scan function
    and its own apply/dry-run path so the online migration logic stays explicit and auditable.
    """

    _tenant_id: str
    _engine: sa.Engine
    _apply: bool
    _output: io.TextIOBase
    _model_types: tuple[ModelType, ...]
    _orm_models: tuple[ORMModel, ...]
    _batch_size: int
    _lock_timeout_seconds: int

    def __init__(
        self,
        tenant_id: str,
        engine: sa.Engine,
        apply: bool,
        output: io.TextIOBase,
        model_types: Sequence[ModelType],
        orm_models: Sequence[ORMModel],
    ) -> None:
        self._tenant_id = tenant_id
        self._engine = engine
        self._apply = apply
        self._output = output
        self._model_types = tuple(model_types)
        self._orm_models = tuple(orm_models)
        self._batch_size = 200
        self._lock_timeout_seconds = 5

    def run(self) -> None:
        self._log_event(
            "tenant_started",
            "Started tenant migration.",
            {
                "tenant_id": self._tenant_id,
                "apply": self._apply,
                "tables": [model.__tablename__ for model in self._orm_models],
                "model_types": [model_type.value for model_type in self._model_types],
            },
        )

        for orm_model in self._orm_models:
            if orm_model is ProviderModel:
                self._migrate_provider_models()
            elif orm_model is TenantDefaultModel:
                self._migrate_tenant_default_models()
            elif orm_model is ProviderModelSetting:
                self._migrate_provider_model_settings()
            elif orm_model is LoadBalancingModelConfig:
                self._migrate_load_balancing_model_configs()
            elif orm_model is ProviderModelCredential:
                self._migrate_provider_model_credentials()

        self._log_event(
            "tenant_completed",
            "Completed tenant migration.",
            {"tenant_id": self._tenant_id, "apply": self._apply},
        )

    def _selected_legacy_values(self) -> list[str]:
        return _selected_legacy_values(self._model_types)

    def _selected_model_type_values(self) -> list[str]:
        return _selected_model_type_values(self._model_types)

    def _allowed_values_for_canonical_model_type(self, canonical_model_type: ModelType) -> tuple[str, ...]:
        return (*_CANONICAL_TO_LEGACY[canonical_model_type], canonical_model_type.value)

    def _normalize_selected_model_type(self, raw_model_type: str) -> ModelType | None:
        canonical_model_type = _LEGACY_TO_CANONICAL.get(raw_model_type)
        if canonical_model_type is not None:
            return canonical_model_type

        try:
            parsed_model_type = ModelType(raw_model_type)
        except ValueError:
            return None

        if parsed_model_type not in self._model_types:
            return None
        return parsed_model_type

    def _has_legacy_rows[T: TypeBase](self, rows: Sequence[_RowWithRawModelType[T]]) -> bool:
        return any(row.raw_model_type in _LEGACY_TO_CANONICAL for row in rows)

    def _select_winner[T: TypeBase](self, rows: Sequence[_RowWithRawModelType[T]]) -> _RowWithRawModelType[T]:
        return max(rows, key=lambda row: self._winner_sort_key(row.row))

    def _winner_sort_key(self, row: TypeBase) -> tuple[datetime, str]:
        typed_row = cast(_HasRowIdAndUpdatedAt, row)
        return typed_row.updated_at, str(typed_row.id)

    def _row_id(self, row: TypeBase) -> str:
        return str(cast(_HasRowId, row).id)

    def _new_tx_id(self) -> str:
        return str(uuid.uuid4())

    def _migrate_provider_models(self) -> None:
        self._log_event(
            "table_started",
            "Started table migration.",
            {"tenant_id": self._tenant_id, "apply": self._apply, "table_name": ProviderModel.__tablename__},
        )

        seen_business_keys: dict[_ProviderModelBusinessKey, list[str]] = {}
        processed_groups = 0
        last_id: str | None = None

        while True:
            candidates = self._load_provider_model_candidates(last_id)
            if not candidates:
                break

            for candidate in candidates:
                last_id = str(candidate.row.id)
                business_key = _ProviderModelBusinessKey(
                    tenant_id=candidate.row.tenant_id,
                    provider_name=candidate.row.provider_name,
                    model_name=candidate.row.model_name,
                    model_type=candidate.canonical_model_type,
                )
                if business_key in seen_business_keys:
                    continue

                seen_business_keys[business_key] = self._process_provider_model_group(candidate, business_key)
                processed_groups += 1

        self._log_event(
            "table_completed",
            "Completed table migration.",
            {
                "tenant_id": self._tenant_id,
                "apply": self._apply,
                "table_name": ProviderModel.__tablename__,
                "processed_groups": processed_groups,
            },
        )

    def _load_provider_model_candidates(self, last_id: str | None) -> list[_RowWithRawModelType[ProviderModel]]:
        raw_model_type = sa.type_coerce(ProviderModel.model_type, sa.String()).label(_RAW_MODEL_TYPE_COLUMN)
        with _session_factory(self._engine) as session:
            stmt = (
                select(ProviderModel, raw_model_type)
                .where(
                    ProviderModel.tenant_id == self._tenant_id,
                    sa.type_coerce(ProviderModel.model_type, sa.String()).in_(self._selected_legacy_values()),
                )
                .order_by(ProviderModel.id.asc())
                .limit(self._batch_size)
            )
            if last_id is not None:
                stmt = stmt.where(ProviderModel.id > last_id)
            rows = session.execute(stmt).all()

        wrapped_rows: list[_RowWithRawModelType[ProviderModel]] = []
        for provider_model, raw_value in rows:
            canonical_model_type = _LEGACY_TO_CANONICAL.get(str(raw_value))
            if canonical_model_type is None:
                self._log_event(
                    event="invalid_model_type",
                    message=f"invalid model type: {raw_value}",
                    attrs={"id": provider_model.id, "table_name": provider_model.__tablename__},
                )
                continue
            wrapped_rows.append(
                _RowWithRawModelType(
                    row=provider_model,
                    raw_model_type=str(raw_value),
                    canonical_model_type=canonical_model_type,
                )
            )
        return wrapped_rows

    def _load_provider_model_group(
        self,
        session: Session,
        candidate: _RowWithRawModelType[ProviderModel],
        *,
        lock_rows: bool,
    ) -> list[_RowWithRawModelType[ProviderModel]]:
        raw_model_type = sa.type_coerce(ProviderModel.model_type, sa.String()).label(_RAW_MODEL_TYPE_COLUMN)
        stmt = (
            select(ProviderModel, raw_model_type)
            .where(
                ProviderModel.tenant_id == candidate.row.tenant_id,
                ProviderModel.provider_name == candidate.row.provider_name,
                ProviderModel.model_name == candidate.row.model_name,
                sa.type_coerce(ProviderModel.model_type, sa.String()).in_(
                    self._allowed_values_for_canonical_model_type(candidate.canonical_model_type)
                ),
            )
            .order_by(ProviderModel.id.asc())
        )
        if lock_rows:
            stmt = stmt.with_for_update()

        rows = session.execute(stmt).all()
        wrapped_rows: list[_RowWithRawModelType[ProviderModel]] = []
        for provider_model, raw_value in rows:
            raw_model_type_value = str(raw_value)
            wrapped_rows.append(
                _RowWithRawModelType(
                    row=provider_model,
                    raw_model_type=raw_model_type_value,
                    canonical_model_type=_LEGACY_TO_CANONICAL.get(
                        raw_model_type_value,
                        candidate.canonical_model_type,
                    ),
                )
            )
        return wrapped_rows

    def _build_provider_model_group_plan(
        self,
        session: Session,
        candidate: _RowWithRawModelType[ProviderModel],
        *,
        lock_rows: bool,
    ) -> _ProviderModelGroupPlan:
        rows = self._load_provider_model_group(session, candidate, lock_rows=lock_rows)
        group_row_ids = [str(row.row.id) for row in rows]
        if not self._has_legacy_rows(rows):
            return _ProviderModelGroupPlan(group_row_ids=group_row_ids, winner=None, loser_rows=[])

        winner = self._select_winner(rows)
        return _ProviderModelGroupPlan(
            group_row_ids=group_row_ids,
            winner=winner,
            loser_rows=[row for row in rows if row.row.id != winner.row.id],
        )

    def _emit_provider_model_group_plan(
        self,
        plan: _ProviderModelGroupPlan,
        *,
        session: Session,
        tx_id: str,
        business_key: _BusinessKey,
    ) -> None:
        if plan.winner is None:
            return

        cache_plans: list[_CacheDeletePlan] = []
        for loser in plan.loser_rows:
            if self._apply:
                session.execute(sa.delete(ProviderModel).where(ProviderModel.id == str(loser.row.id)))
            self._log_row_deleted(
                ProviderModel.__tablename__,
                loser,
                tx_id=tx_id,
                business_key=business_key,
                related_winner_id=str(plan.winner.row.id),
            )
            cache_plans.append(
                _CacheDeletePlan(
                    tenant_id=self._tenant_id,
                    identity_id=str(loser.row.id),
                    cache_type=ProviderCredentialsCacheType.MODEL,
                    table_name=ProviderModel.__tablename__,
                    row_id=str(loser.row.id),
                    tx_id=tx_id,
                    business_key=business_key,
                )
            )

        if plan.winner.raw_model_type != plan.winner.canonical_model_type.value:
            if self._apply:
                session.execute(
                    sa.update(ProviderModel)
                    .where(ProviderModel.id == str(plan.winner.row.id))
                    .values(model_type=plan.winner.canonical_model_type.value)
                )
            self._log_row_updated(
                ProviderModel.__tablename__,
                str(plan.winner.row.id),
                {"model_type": plan.winner.raw_model_type},
                {"model_type": plan.winner.canonical_model_type.value},
                tx_id=tx_id,
                business_key=business_key,
            )
            cache_plans.append(
                _CacheDeletePlan(
                    tenant_id=self._tenant_id,
                    identity_id=str(plan.winner.row.id),
                    cache_type=ProviderCredentialsCacheType.MODEL,
                    table_name=ProviderModel.__tablename__,
                    row_id=str(plan.winner.row.id),
                    tx_id=tx_id,
                    business_key=business_key,
                )
            )

        self._log_cache_plans(cache_plans, apply=self._apply)
        self._log_group_processed(
            ProviderModel.__tablename__,
            business_key,
            plan.group_row_ids,
            tx_id=tx_id,
        )

    def _process_provider_model_group(
        self,
        candidate: _RowWithRawModelType[ProviderModel],
        business_key: _ProviderModelBusinessKey,
    ) -> list[str]:
        tx_id = self._new_tx_id()
        group_row_ids = [str(candidate.row.id)]

        try:
            with _session_factory(self._engine) as session, session.begin():
                self._configure_lock_timeout(session)
                plan = self._build_provider_model_group_plan(session, candidate, lock_rows=True)
                group_row_ids = plan.group_row_ids or group_row_ids
                self._emit_provider_model_group_plan(
                    plan,
                    session=session,
                    tx_id=tx_id,
                    business_key=business_key,
                )
        except OperationalError as exc:
            if self._is_lock_timeout_error(exc):
                self._log_lock_timeout(
                    ProviderModel.__tablename__,
                    str(candidate.row.id),
                    tx_id,
                    business_key,
                    exc,
                )
                return group_row_ids
            raise

        return group_row_ids

    def _migrate_tenant_default_models(self) -> None:
        self._log_event(
            "table_started",
            "Started table migration.",
            {"tenant_id": self._tenant_id, "apply": self._apply, "table_name": TenantDefaultModel.__tablename__},
        )

        seen_business_keys: dict[_TenantDefaultModelBusinessKey, list[str]] = {}
        processed_groups = 0
        last_id: str | None = None

        while True:
            candidates = self._load_tenant_default_model_candidates(last_id)
            if not candidates:
                break

            for candidate in candidates:
                last_id = str(candidate.row.id)
                business_key = _TenantDefaultModelBusinessKey(
                    tenant_id=candidate.row.tenant_id,
                    model_type=candidate.canonical_model_type,
                )
                if business_key in seen_business_keys:
                    continue

                seen_business_keys[business_key] = self._process_tenant_default_model_group(candidate, business_key)
                processed_groups += 1

        self._log_event(
            "table_completed",
            "Completed table migration.",
            {
                "tenant_id": self._tenant_id,
                "apply": self._apply,
                "table_name": TenantDefaultModel.__tablename__,
                "processed_groups": processed_groups,
            },
        )

    def _load_tenant_default_model_candidates(
        self, last_id: str | None
    ) -> list[_RowWithRawModelType[TenantDefaultModel]]:
        raw_model_type = sa.type_coerce(TenantDefaultModel.model_type, sa.String()).label(_RAW_MODEL_TYPE_COLUMN)
        with _session_factory(self._engine) as session:
            stmt = (
                select(TenantDefaultModel, raw_model_type)
                .where(
                    TenantDefaultModel.tenant_id == self._tenant_id,
                    sa.type_coerce(TenantDefaultModel.model_type, sa.String()).in_(self._selected_legacy_values()),
                )
                .order_by(TenantDefaultModel.id.asc())
                .limit(self._batch_size)
            )
            if last_id is not None:
                stmt = stmt.where(TenantDefaultModel.id > last_id)
            rows = session.execute(stmt).all()

        wrapped_rows: list[_RowWithRawModelType[TenantDefaultModel]] = []
        for tenant_default_model, raw_value in rows:
            canonical_model_type = _LEGACY_TO_CANONICAL.get(str(raw_value))
            if canonical_model_type is None:
                self._log_event(
                    event="invalid_model_type",
                    message=f"invalid model type: {raw_value}",
                    attrs={"id": tenant_default_model.id, "table_name": tenant_default_model.__tablename__},
                )
                continue
            wrapped_rows.append(
                _RowWithRawModelType(
                    row=tenant_default_model,
                    raw_model_type=str(raw_value),
                    canonical_model_type=canonical_model_type,
                )
            )
        return wrapped_rows

    def _load_tenant_default_model_group(
        self,
        session: Session,
        candidate: _RowWithRawModelType[TenantDefaultModel],
        *,
        lock_rows: bool,
    ) -> list[_RowWithRawModelType[TenantDefaultModel]]:
        raw_model_type = sa.type_coerce(TenantDefaultModel.model_type, sa.String()).label(_RAW_MODEL_TYPE_COLUMN)
        stmt = (
            select(TenantDefaultModel, raw_model_type)
            .where(
                TenantDefaultModel.tenant_id == candidate.row.tenant_id,
                sa.type_coerce(TenantDefaultModel.model_type, sa.String()).in_(
                    self._allowed_values_for_canonical_model_type(candidate.canonical_model_type)
                ),
            )
            .order_by(TenantDefaultModel.id.asc())
        )
        if lock_rows:
            stmt = stmt.with_for_update()

        rows = session.execute(stmt).all()
        wrapped_rows: list[_RowWithRawModelType[TenantDefaultModel]] = []
        for tenant_default_model, raw_value in rows:
            raw_model_type_value = str(raw_value)
            wrapped_rows.append(
                _RowWithRawModelType(
                    row=tenant_default_model,
                    raw_model_type=raw_model_type_value,
                    canonical_model_type=_LEGACY_TO_CANONICAL.get(
                        raw_model_type_value,
                        candidate.canonical_model_type,
                    ),
                )
            )
        return wrapped_rows

    def _build_tenant_default_model_group_plan(
        self,
        session: Session,
        candidate: _RowWithRawModelType[TenantDefaultModel],
        *,
        lock_rows: bool,
    ) -> _TenantDefaultModelGroupPlan:
        rows = self._load_tenant_default_model_group(session, candidate, lock_rows=lock_rows)
        group_row_ids = [str(row.row.id) for row in rows]
        if not self._has_legacy_rows(rows):
            return _TenantDefaultModelGroupPlan(group_row_ids=group_row_ids, winner=None, loser_rows=[])

        winner = self._select_winner(rows)
        return _TenantDefaultModelGroupPlan(
            group_row_ids=group_row_ids,
            winner=winner,
            loser_rows=[row for row in rows if row.row.id != winner.row.id],
        )

    def _emit_tenant_default_model_group_plan(
        self,
        plan: _TenantDefaultModelGroupPlan,
        *,
        session: Session,
        tx_id: str,
        business_key: _BusinessKey,
    ) -> None:
        if plan.winner is None:
            return

        for loser in plan.loser_rows:
            if self._apply:
                session.execute(sa.delete(TenantDefaultModel).where(TenantDefaultModel.id == str(loser.row.id)))
            self._log_row_deleted(
                TenantDefaultModel.__tablename__,
                loser,
                tx_id=tx_id,
                business_key=business_key,
                related_winner_id=str(plan.winner.row.id),
            )
        if plan.winner.raw_model_type != plan.winner.canonical_model_type.value:
            if self._apply:
                session.execute(
                    sa.update(TenantDefaultModel)
                    .where(TenantDefaultModel.id == str(plan.winner.row.id))
                    .values(model_type=plan.winner.canonical_model_type.value)
                )
            self._log_row_updated(
                TenantDefaultModel.__tablename__,
                str(plan.winner.row.id),
                {"model_type": plan.winner.raw_model_type},
                {"model_type": plan.winner.canonical_model_type.value},
                tx_id=tx_id,
                business_key=business_key,
            )

        self._log_group_processed(
            TenantDefaultModel.__tablename__,
            business_key,
            plan.group_row_ids,
            tx_id=tx_id,
        )

    def _process_tenant_default_model_group(
        self,
        candidate: _RowWithRawModelType[TenantDefaultModel],
        business_key: _TenantDefaultModelBusinessKey,
    ) -> list[str]:
        tx_id = self._new_tx_id()
        group_row_ids = [str(candidate.row.id)]

        try:
            with _session_factory(self._engine) as session, session.begin():
                self._configure_lock_timeout(session)
                plan = self._build_tenant_default_model_group_plan(session, candidate, lock_rows=True)
                group_row_ids = plan.group_row_ids or group_row_ids
                self._emit_tenant_default_model_group_plan(
                    plan,
                    session=session,
                    tx_id=tx_id,
                    business_key=business_key,
                )
        except OperationalError as exc:
            if self._is_lock_timeout_error(exc):
                self._log_lock_timeout(
                    TenantDefaultModel.__tablename__,
                    str(candidate.row.id),
                    tx_id,
                    business_key,
                    exc,
                )
                return group_row_ids
            raise
        return group_row_ids

    def _migrate_provider_model_settings(self) -> None:
        self._log_event(
            "table_started",
            "Started table migration.",
            {"tenant_id": self._tenant_id, "apply": self._apply, "table_name": ProviderModelSetting.__tablename__},
        )

        seen_business_keys: dict[_ProviderModelSettingBusinessKey, list[str]] = {}
        processed_groups = 0
        last_id: str | None = None

        while True:
            candidates = self._load_provider_model_setting_candidates(last_id)
            if not candidates:
                break

            for candidate in candidates:
                last_id = str(candidate.row.id)
                business_key = _ProviderModelSettingBusinessKey(
                    tenant_id=candidate.row.tenant_id,
                    provider_name=candidate.row.provider_name,
                    model_name=candidate.row.model_name,
                    model_type=candidate.canonical_model_type,
                )
                if business_key in seen_business_keys:
                    continue

                seen_business_keys[business_key] = self._process_provider_model_setting_group(candidate, business_key)
                processed_groups += 1

        self._log_event(
            "table_completed",
            "Completed table migration.",
            {
                "tenant_id": self._tenant_id,
                "apply": self._apply,
                "table_name": ProviderModelSetting.__tablename__,
                "processed_groups": processed_groups,
            },
        )

    def _load_provider_model_setting_candidates(
        self, last_id: str | None
    ) -> list[_RowWithRawModelType[ProviderModelSetting]]:
        raw_model_type = sa.type_coerce(ProviderModelSetting.model_type, sa.String()).label(_RAW_MODEL_TYPE_COLUMN)
        with _session_factory(self._engine) as session:
            stmt = (
                select(ProviderModelSetting, raw_model_type)
                .where(
                    ProviderModelSetting.tenant_id == self._tenant_id,
                    sa.type_coerce(ProviderModelSetting.model_type, sa.String()).in_(self._selected_legacy_values()),
                )
                .order_by(ProviderModelSetting.id.asc())
                .limit(self._batch_size)
            )
            if last_id is not None:
                stmt = stmt.where(ProviderModelSetting.id > last_id)
            rows = session.execute(stmt).all()

        wrapped_rows: list[_RowWithRawModelType[ProviderModelSetting]] = []
        for provider_model_setting, raw_value in rows:
            canonical_model_type = _LEGACY_TO_CANONICAL.get(str(raw_value))
            if canonical_model_type is None:
                self._log_event(
                    event="invalid_model_type",
                    message=f"invalid model type: {raw_value}",
                    attrs={"id": provider_model_setting.id, "table_name": provider_model_setting.__tablename__},
                )
                continue
            wrapped_rows.append(
                _RowWithRawModelType(
                    row=provider_model_setting,
                    raw_model_type=str(raw_value),
                    canonical_model_type=canonical_model_type,
                )
            )
        return wrapped_rows

    def _load_provider_model_setting_group(
        self,
        session: Session,
        candidate: _RowWithRawModelType[ProviderModelSetting],
        *,
        lock_rows: bool,
    ) -> list[_RowWithRawModelType[ProviderModelSetting]]:
        raw_model_type = sa.type_coerce(ProviderModelSetting.model_type, sa.String()).label(_RAW_MODEL_TYPE_COLUMN)
        stmt = (
            select(ProviderModelSetting, raw_model_type)
            .where(
                ProviderModelSetting.tenant_id == candidate.row.tenant_id,
                ProviderModelSetting.provider_name == candidate.row.provider_name,
                ProviderModelSetting.model_name == candidate.row.model_name,
                sa.type_coerce(ProviderModelSetting.model_type, sa.String()).in_(
                    self._allowed_values_for_canonical_model_type(candidate.canonical_model_type)
                ),
            )
            .order_by(ProviderModelSetting.id.asc())
        )
        if lock_rows:
            stmt = stmt.with_for_update()

        rows = session.execute(stmt).all()
        wrapped_rows: list[_RowWithRawModelType[ProviderModelSetting]] = []
        for provider_model_setting, raw_value in rows:
            raw_model_type_value = str(raw_value)
            wrapped_rows.append(
                _RowWithRawModelType(
                    row=provider_model_setting,
                    raw_model_type=raw_model_type_value,
                    canonical_model_type=_LEGACY_TO_CANONICAL.get(
                        raw_model_type_value,
                        candidate.canonical_model_type,
                    ),
                )
            )
        return wrapped_rows

    def _build_provider_model_setting_group_plan(
        self,
        session: Session,
        candidate: _RowWithRawModelType[ProviderModelSetting],
        *,
        lock_rows: bool,
    ) -> _ProviderModelSettingGroupPlan:
        rows = self._load_provider_model_setting_group(session, candidate, lock_rows=lock_rows)
        group_row_ids = [str(row.row.id) for row in rows]
        if not self._has_legacy_rows(rows):
            return _ProviderModelSettingGroupPlan(group_row_ids=group_row_ids, winner=None, loser_rows=[])

        winner = self._select_winner(rows)
        return _ProviderModelSettingGroupPlan(
            group_row_ids=group_row_ids,
            winner=winner,
            loser_rows=[row for row in rows if row.row.id != winner.row.id],
        )

    def _emit_provider_model_setting_group_plan(
        self,
        plan: _ProviderModelSettingGroupPlan,
        *,
        session: Session,
        tx_id: str,
        business_key: _BusinessKey,
    ) -> None:
        if plan.winner is None:
            return

        for loser in plan.loser_rows:
            if self._apply:
                session.execute(sa.delete(ProviderModelSetting).where(ProviderModelSetting.id == str(loser.row.id)))
            self._log_row_deleted(
                ProviderModelSetting.__tablename__,
                loser,
                tx_id=tx_id,
                business_key=business_key,
                related_winner_id=str(plan.winner.row.id),
            )

        if plan.winner.raw_model_type != plan.winner.canonical_model_type.value:
            if self._apply:
                session.execute(
                    sa.update(ProviderModelSetting)
                    .where(ProviderModelSetting.id == str(plan.winner.row.id))
                    .values(model_type=plan.winner.canonical_model_type.value)
                )
            self._log_row_updated(
                ProviderModelSetting.__tablename__,
                str(plan.winner.row.id),
                {"model_type": plan.winner.raw_model_type},
                {"model_type": plan.winner.canonical_model_type.value},
                tx_id=tx_id,
                business_key=business_key,
            )

        self._log_group_processed(
            ProviderModelSetting.__tablename__,
            business_key,
            plan.group_row_ids,
            tx_id=tx_id,
        )

    def _process_provider_model_setting_group(
        self,
        candidate: _RowWithRawModelType[ProviderModelSetting],
        business_key: _ProviderModelSettingBusinessKey,
    ) -> list[str]:
        tx_id = self._new_tx_id()
        group_row_ids = [str(candidate.row.id)]

        try:
            with _session_factory(self._engine) as session, session.begin():
                self._configure_lock_timeout(session)
                plan = self._build_provider_model_setting_group_plan(session, candidate, lock_rows=True)
                group_row_ids = plan.group_row_ids or group_row_ids
                self._emit_provider_model_setting_group_plan(
                    plan,
                    session=session,
                    tx_id=tx_id,
                    business_key=business_key,
                )
        except OperationalError as exc:
            if self._is_lock_timeout_error(exc):
                self._log_lock_timeout(
                    ProviderModelSetting.__tablename__,
                    str(candidate.row.id),
                    tx_id,
                    business_key,
                    exc,
                )
                return group_row_ids
            raise
        return group_row_ids

    def _migrate_load_balancing_model_configs(self) -> None:
        """
        Migrate load-balancing configs row by row.

        This table first deduplicates `name="__inherit__"` rows per normalized
        `(tenant_id, provider_name, model_name, model_type)` business key, then
        canonicalizes the remaining legacy rows independently. The pre-pass must run
        first so a legacy/canonical `__inherit__` pair keeps only the newest row before
        the row-level canonicalization would collapse them onto the same canonical key.
        """
        self._log_event(
            "table_started",
            "Started table migration.",
            {
                "tenant_id": self._tenant_id,
                "apply": self._apply,
                "table_name": LoadBalancingModelConfig.__tablename__,
            },
        )

        processed_inherit_groups = self._deduplicate_inherit_load_balancing_model_configs()
        processed_rows = 0
        last_id: str | None = None

        while True:
            candidates = self._load_load_balancing_model_config_candidates(last_id)
            if not candidates:
                break

            for candidate in candidates:
                last_id = str(candidate.row.id)
                processed_rows += 1
                self._process_load_balancing_model_config_row(candidate)

        self._log_event(
            "table_completed",
            "Completed table migration.",
            {
                "tenant_id": self._tenant_id,
                "apply": self._apply,
                "table_name": LoadBalancingModelConfig.__tablename__,
                "processed_inherit_groups": processed_inherit_groups,
                "processed_rows": processed_rows,
            },
        )

    def _deduplicate_inherit_load_balancing_model_configs(self) -> int:
        seen_business_keys: dict[_LoadBalancingModelConfigInheritBusinessKey, list[str]] = {}
        processed_groups = 0
        last_id: str | None = None

        while True:
            candidates = self._load_load_balancing_inherit_candidates(last_id)
            if not candidates:
                break

            for candidate in candidates:
                last_id = str(candidate.row.id)
                business_key = _LoadBalancingModelConfigInheritBusinessKey(
                    tenant_id=candidate.row.tenant_id,
                    provider_name=candidate.row.provider_name,
                    model_name=candidate.row.model_name,
                    model_type=candidate.canonical_model_type,
                )
                if business_key in seen_business_keys:
                    continue

                seen_business_keys[business_key] = self._process_load_balancing_inherit_group(candidate, business_key)
                processed_groups += 1

        return processed_groups

    def _load_load_balancing_inherit_candidates(
        self, last_id: str | None
    ) -> list[_RowWithRawModelType[LoadBalancingModelConfig]]:
        raw_model_type = sa.type_coerce(LoadBalancingModelConfig.model_type, sa.String()).label(_RAW_MODEL_TYPE_COLUMN)
        with _session_factory(self._engine) as session:
            stmt = (
                select(LoadBalancingModelConfig, raw_model_type)
                .where(
                    LoadBalancingModelConfig.tenant_id == self._tenant_id,
                    LoadBalancingModelConfig.name == "__inherit__",
                    sa.type_coerce(LoadBalancingModelConfig.model_type, sa.String()).in_(
                        self._selected_model_type_values()
                    ),
                )
                .order_by(LoadBalancingModelConfig.id.asc())
                .limit(self._batch_size)
            )
            if last_id is not None:
                stmt = stmt.where(LoadBalancingModelConfig.id > last_id)
            rows = session.execute(stmt).all()

        wrapped_rows: list[_RowWithRawModelType[LoadBalancingModelConfig]] = []
        for load_balancing_model_config, raw_value in rows:
            raw_model_type_value = str(raw_value)
            canonical_model_type = self._normalize_selected_model_type(raw_model_type_value)
            if canonical_model_type is None:
                self._log_event(
                    event="invalid_model_type",
                    message=f"invalid model type: {raw_value}",
                    attrs={
                        "id": load_balancing_model_config.id,
                        "table_name": load_balancing_model_config.__tablename__,
                    },
                )
                continue

            wrapped_rows.append(
                _RowWithRawModelType(
                    row=load_balancing_model_config,
                    raw_model_type=raw_model_type_value,
                    canonical_model_type=canonical_model_type,
                )
            )
        return wrapped_rows

    def _load_load_balancing_inherit_group(
        self,
        session: Session,
        candidate: _RowWithRawModelType[LoadBalancingModelConfig],
        *,
        lock_rows: bool,
    ) -> list[_RowWithRawModelType[LoadBalancingModelConfig]]:
        raw_model_type = sa.type_coerce(LoadBalancingModelConfig.model_type, sa.String()).label(_RAW_MODEL_TYPE_COLUMN)
        stmt = (
            select(LoadBalancingModelConfig, raw_model_type)
            .where(
                LoadBalancingModelConfig.tenant_id == candidate.row.tenant_id,
                LoadBalancingModelConfig.provider_name == candidate.row.provider_name,
                LoadBalancingModelConfig.model_name == candidate.row.model_name,
                LoadBalancingModelConfig.name == "__inherit__",
                sa.type_coerce(LoadBalancingModelConfig.model_type, sa.String()).in_(
                    self._allowed_values_for_canonical_model_type(candidate.canonical_model_type)
                ),
            )
            .order_by(LoadBalancingModelConfig.id.asc())
        )
        if lock_rows:
            stmt = stmt.with_for_update()

        rows = session.execute(stmt).all()
        wrapped_rows: list[_RowWithRawModelType[LoadBalancingModelConfig]] = []
        for load_balancing_model_config, raw_value in rows:
            raw_model_type_value = str(raw_value)
            canonical_model_type = self._normalize_selected_model_type(raw_model_type_value)
            if canonical_model_type is None:
                continue
            wrapped_rows.append(
                _RowWithRawModelType(
                    row=load_balancing_model_config,
                    raw_model_type=raw_model_type_value,
                    canonical_model_type=canonical_model_type,
                )
            )
        return wrapped_rows

    def _build_load_balancing_inherit_group_plan(
        self,
        session: Session,
        candidate: _RowWithRawModelType[LoadBalancingModelConfig],
        *,
        lock_rows: bool,
    ) -> _LoadBalancingModelConfigInheritGroupPlan:
        rows = self._load_load_balancing_inherit_group(session, candidate, lock_rows=lock_rows)
        group_row_ids = [str(row.row.id) for row in rows]
        if len(rows) <= 1:
            return _LoadBalancingModelConfigInheritGroupPlan(group_row_ids=group_row_ids, winner=None, loser_rows=[])

        winner = self._select_winner(rows)
        return _LoadBalancingModelConfigInheritGroupPlan(
            group_row_ids=group_row_ids,
            winner=winner,
            loser_rows=[row for row in rows if row.row.id != winner.row.id],
        )

    def _emit_load_balancing_inherit_group_plan(
        self,
        plan: _LoadBalancingModelConfigInheritGroupPlan,
        *,
        session: Session,
        tx_id: str,
        business_key: _LoadBalancingModelConfigInheritBusinessKey,
    ) -> None:
        if plan.winner is None:
            return

        cache_plans: list[_CacheDeletePlan] = []
        for loser in plan.loser_rows:
            loser_row_id = str(loser.row.id)
            if self._apply:
                session.execute(sa.delete(LoadBalancingModelConfig).where(LoadBalancingModelConfig.id == loser_row_id))
            self._log_row_deleted(
                LoadBalancingModelConfig.__tablename__,
                loser,
                tx_id=tx_id,
                business_key=business_key,
                related_winner_id=str(plan.winner.row.id),
            )
            cache_plans.append(
                _CacheDeletePlan(
                    tenant_id=self._tenant_id,
                    identity_id=loser_row_id,
                    cache_type=ProviderCredentialsCacheType.LOAD_BALANCING_MODEL,
                    table_name=LoadBalancingModelConfig.__tablename__,
                    row_id=loser_row_id,
                    tx_id=tx_id,
                    business_key=business_key,
                )
            )

        self._log_cache_plans(cache_plans, apply=self._apply)
        self._log_group_processed(
            LoadBalancingModelConfig.__tablename__,
            business_key,
            plan.group_row_ids,
            tx_id=tx_id,
        )

    def _process_load_balancing_inherit_group(
        self,
        candidate: _RowWithRawModelType[LoadBalancingModelConfig],
        business_key: _LoadBalancingModelConfigInheritBusinessKey,
    ) -> list[str]:
        tx_id = self._new_tx_id()
        group_row_ids = [str(candidate.row.id)]

        try:
            with _session_factory(self._engine) as session, session.begin():
                self._configure_lock_timeout(session)
                plan = self._build_load_balancing_inherit_group_plan(session, candidate, lock_rows=True)
                group_row_ids = plan.group_row_ids or group_row_ids
                self._emit_load_balancing_inherit_group_plan(
                    plan,
                    session=session,
                    tx_id=tx_id,
                    business_key=business_key,
                )
        except OperationalError as exc:
            if self._is_lock_timeout_error(exc):
                self._log_lock_timeout(
                    LoadBalancingModelConfig.__tablename__,
                    str(candidate.row.id),
                    tx_id,
                    business_key,
                    exc,
                )
                return group_row_ids
            raise

        return group_row_ids

    def _load_load_balancing_model_config_candidates(
        self, last_id: str | None
    ) -> list[_RowWithRawModelType[LoadBalancingModelConfig]]:
        raw_model_type = sa.type_coerce(LoadBalancingModelConfig.model_type, sa.String()).label(_RAW_MODEL_TYPE_COLUMN)
        with _session_factory(self._engine) as session:
            stmt = (
                select(LoadBalancingModelConfig, raw_model_type)
                .where(
                    LoadBalancingModelConfig.tenant_id == self._tenant_id,
                    sa.type_coerce(LoadBalancingModelConfig.model_type, sa.String()).in_(
                        self._selected_legacy_values()
                    ),
                )
                .order_by(LoadBalancingModelConfig.id.asc())
                .limit(self._batch_size)
            )
            if last_id is not None:
                stmt = stmt.where(LoadBalancingModelConfig.id > last_id)
            rows = session.execute(stmt).all()

        wrapped_rows: list[_RowWithRawModelType[LoadBalancingModelConfig]] = []
        for load_balancing_model_config, raw_value in rows:
            canonical_model_type = _LEGACY_TO_CANONICAL.get(str(raw_value))
            if canonical_model_type is None:
                self._log_event(
                    event="invalid_model_type",
                    message=f"invalid model type: {raw_value}",
                    attrs={
                        "id": load_balancing_model_config.id,
                        "table_name": load_balancing_model_config.__tablename__,
                    },
                )
                continue
            wrapped_rows.append(
                _RowWithRawModelType(
                    row=load_balancing_model_config,
                    raw_model_type=str(raw_value),
                    canonical_model_type=canonical_model_type,
                )
            )
        return wrapped_rows

    def _reload_load_balancing_model_config_candidate(
        self,
        session: Session,
        candidate: _RowWithRawModelType[LoadBalancingModelConfig],
        *,
        lock_rows: bool,
    ) -> _RowWithRawModelType[LoadBalancingModelConfig] | None:
        raw_model_type = sa.type_coerce(LoadBalancingModelConfig.model_type, sa.String()).label(_RAW_MODEL_TYPE_COLUMN)
        stmt = select(LoadBalancingModelConfig, raw_model_type).where(
            LoadBalancingModelConfig.id == candidate.row.id,
            LoadBalancingModelConfig.tenant_id == self._tenant_id,
        )
        if lock_rows:
            stmt = stmt.with_for_update()

        row = session.execute(stmt).first()
        if row is None:
            return None

        load_balancing_model_config, raw_value = row
        raw_model_type_value = str(raw_value)
        canonical_model_type = _LEGACY_TO_CANONICAL.get(raw_model_type_value)
        if canonical_model_type is None:
            return None

        return _RowWithRawModelType(
            row=load_balancing_model_config,
            raw_model_type=raw_model_type_value,
            canonical_model_type=canonical_model_type,
        )

    def _log_load_balancing_model_config_cache_cleanup(
        self,
        *,
        row_id: str,
        tx_id: str,
    ) -> None:
        attrs = {
            "tenant_id": self._tenant_id,
            "apply": self._apply,
            "table_name": LoadBalancingModelConfig.__tablename__,
            "id": row_id,
            "cache_type": ProviderCredentialsCacheType.LOAD_BALANCING_MODEL.value,
            "tx_id": tx_id,
        }
        if not self._apply:
            self._log_event(
                "cache_delete_planned",
                "Would delete related cache entry in apply mode.",
                attrs,
            )
            return

        try:
            ProviderCredentialsCache(
                tenant_id=self._tenant_id,
                identity_id=row_id,
                cache_type=ProviderCredentialsCacheType.LOAD_BALANCING_MODEL,
            ).delete()
            self._log_event("cache_deleted", "Deleted related cache entry.", attrs)
        except Exception as exc:
            self._log_exception_event(
                "cache_delete_failed",
                "Failed to delete related cache entry.",
                attrs,
                exc,
            )

    def _process_load_balancing_model_config_row(
        self, candidate: _RowWithRawModelType[LoadBalancingModelConfig]
    ) -> None:
        tx_id = self._new_tx_id()
        processed_row_id: str | None = None

        try:
            with _session_factory(self._engine) as session, session.begin():
                self._configure_lock_timeout(session)
                current_row = self._reload_load_balancing_model_config_candidate(session, candidate, lock_rows=True)
                if current_row is None:
                    return
                processed_row_id = str(current_row.row.id)

                if self._apply:
                    session.execute(
                        sa.update(LoadBalancingModelConfig)
                        .where(LoadBalancingModelConfig.id == processed_row_id)
                        .values(model_type=current_row.canonical_model_type.value)
                    )
                self._log_row_updated(
                    LoadBalancingModelConfig.__tablename__,
                    processed_row_id,
                    {"model_type": current_row.raw_model_type},
                    {"model_type": current_row.canonical_model_type.value},
                    tx_id=tx_id,
                )
        except OperationalError as exc:
            if self._is_lock_timeout_error(exc):
                self._log_lock_timeout(
                    LoadBalancingModelConfig.__tablename__,
                    str(candidate.row.id),
                    tx_id,
                    None,
                    exc,
                )
                return
            raise

        if processed_row_id is not None:
            self._log_load_balancing_model_config_cache_cleanup(row_id=processed_row_id, tx_id=tx_id)

    def _migrate_provider_model_credentials(self) -> None:
        self._log_event(
            "table_started",
            "Started table migration.",
            {
                "tenant_id": self._tenant_id,
                "apply": self._apply,
                "table_name": ProviderModelCredential.__tablename__,
            },
        )

        seen_business_keys: dict[_ProviderModelCredentialBusinessKey, list[str]] = {}
        processed_groups = 0
        last_id: str | None = None

        while True:
            candidates = self._load_provider_model_credential_candidates(last_id)
            if not candidates:
                break

            for candidate in candidates:
                last_id = str(candidate.row.id)
                business_key = _ProviderModelCredentialBusinessKey(
                    tenant_id=candidate.row.tenant_id,
                    provider_name=candidate.row.provider_name,
                    model_name=candidate.row.model_name,
                    credential_name=candidate.row.credential_name,
                    model_type=candidate.canonical_model_type,
                )
                if business_key in seen_business_keys:
                    continue

                seen_business_keys[business_key] = self._process_provider_model_credential_group(
                    candidate,
                    business_key,
                )
                processed_groups += 1

        self._log_event(
            "table_completed",
            "Completed table migration.",
            {
                "tenant_id": self._tenant_id,
                "apply": self._apply,
                "table_name": ProviderModelCredential.__tablename__,
                "processed_groups": processed_groups,
            },
        )

    def _load_provider_model_credential_candidates(
        self, last_id: str | None
    ) -> list[_RowWithRawModelType[ProviderModelCredential]]:
        raw_model_type = sa.type_coerce(ProviderModelCredential.model_type, sa.String()).label(_RAW_MODEL_TYPE_COLUMN)
        with _session_factory(self._engine) as session:
            stmt = (
                select(ProviderModelCredential, raw_model_type)
                .where(
                    ProviderModelCredential.tenant_id == self._tenant_id,
                    sa.type_coerce(ProviderModelCredential.model_type, sa.String()).in_(self._selected_legacy_values()),
                )
                .order_by(ProviderModelCredential.id.asc())
                .limit(self._batch_size)
            )
            if last_id is not None:
                stmt = stmt.where(ProviderModelCredential.id > last_id)
            rows = session.execute(stmt).all()

        wrapped_rows: list[_RowWithRawModelType[ProviderModelCredential]] = []
        for provider_model_credential, raw_value in rows:
            canonical_model_type = _LEGACY_TO_CANONICAL.get(str(raw_value))
            if canonical_model_type is None:
                self._log_event(
                    event="invalid_model_type",
                    message=f"invalid model type: {raw_value}",
                    attrs={"id": provider_model_credential.id, "table_name": provider_model_credential.__tablename__},
                )
                continue
            wrapped_rows.append(
                _RowWithRawModelType(
                    row=provider_model_credential,
                    raw_model_type=str(raw_value),
                    canonical_model_type=canonical_model_type,
                )
            )
        return wrapped_rows

    def _load_provider_model_credential_group(
        self,
        session: Session,
        candidate: _RowWithRawModelType[ProviderModelCredential],
        *,
        lock_rows: bool,
    ) -> list[_RowWithRawModelType[ProviderModelCredential]]:
        raw_model_type = sa.type_coerce(ProviderModelCredential.model_type, sa.String()).label(_RAW_MODEL_TYPE_COLUMN)
        stmt = (
            select(ProviderModelCredential, raw_model_type)
            .where(
                ProviderModelCredential.tenant_id == candidate.row.tenant_id,
                ProviderModelCredential.provider_name == candidate.row.provider_name,
                ProviderModelCredential.model_name == candidate.row.model_name,
                ProviderModelCredential.credential_name == candidate.row.credential_name,
                sa.type_coerce(ProviderModelCredential.model_type, sa.String()).in_(
                    self._allowed_values_for_canonical_model_type(candidate.canonical_model_type)
                ),
            )
            .order_by(ProviderModelCredential.id.asc())
        )
        if lock_rows:
            stmt = stmt.with_for_update()

        rows = session.execute(stmt).all()
        wrapped_rows: list[_RowWithRawModelType[ProviderModelCredential]] = []
        for provider_model_credential, raw_value in rows:
            raw_model_type_value = str(raw_value)
            wrapped_rows.append(
                _RowWithRawModelType(
                    row=provider_model_credential,
                    raw_model_type=raw_model_type_value,
                    canonical_model_type=_LEGACY_TO_CANONICAL.get(
                        raw_model_type_value,
                        candidate.canonical_model_type,
                    ),
                )
            )
        return wrapped_rows

    def _build_provider_model_credential_group_plan(
        self,
        session: Session,
        candidate: _RowWithRawModelType[ProviderModelCredential],
        *,
        lock_rows: bool,
    ) -> _ProviderModelCredentialGroupPlan:
        rows = self._load_provider_model_credential_group(session, candidate, lock_rows=lock_rows)
        group_row_ids = [str(row.row.id) for row in rows]
        if not self._has_legacy_rows(rows):
            return _ProviderModelCredentialGroupPlan(
                group_row_ids=group_row_ids,
                winner=None,
                loser_rows=[],
                provider_model_rewrites=[],
                load_balancing_rewrites=[],
            )

        winner = self._select_winner(rows)
        loser_rows = [row for row in rows if row.row.id != winner.row.id]
        return _ProviderModelCredentialGroupPlan(
            group_row_ids=group_row_ids,
            winner=winner,
            loser_rows=loser_rows,
            provider_model_rewrites=self._plan_provider_model_reference_rewrites(
                session,
                winner,
                loser_rows,
                lock_rows=lock_rows,
            ),
            load_balancing_rewrites=self._plan_load_balancing_reference_rewrites(
                session,
                winner,
                loser_rows,
                lock_rows=lock_rows,
            ),
        )

    def _emit_provider_model_reference_rewrites(
        self,
        session: Session,
        rewrites: Sequence[_ProviderModelReferenceRewritePlan],
        *,
        winner_credential_id: str,
        loser_credential_ids: Sequence[str],
        tx_id: str,
        business_key: _BusinessKey,
    ) -> list[_CacheDeletePlan]:
        cache_plans: list[_CacheDeletePlan] = []
        for rewrite in rewrites:
            if self._apply:
                session.execute(
                    sa.update(ProviderModel)
                    .where(ProviderModel.id == rewrite.row_id)
                    .values(credential_id=rewrite.new_credential_id)
                )
            self._log_row_updated(
                ProviderModel.__tablename__,
                rewrite.row_id,
                {"credential_id": rewrite.old_credential_id},
                {"credential_id": rewrite.new_credential_id},
                tx_id=tx_id,
                business_key=business_key,
                rewrite_source={
                    "rewrite_kind": "credential_reference",
                    "winner_credential_id": winner_credential_id,
                    "loser_credential_ids": list(loser_credential_ids),
                },
            )

            cache_plans.append(
                _CacheDeletePlan(
                    tenant_id=self._tenant_id,
                    identity_id=rewrite.row_id,
                    cache_type=ProviderCredentialsCacheType.MODEL,
                    table_name=ProviderModel.__tablename__,
                    row_id=rewrite.row_id,
                    tx_id=tx_id,
                    business_key=business_key,
                )
            )
        return cache_plans

    def _emit_load_balancing_reference_rewrites(
        self,
        session: Session,
        rewrites: Sequence[_LoadBalancingCredentialRewritePlan],
        *,
        winner_credential_id: str,
        loser_credential_ids: Sequence[str],
        tx_id: str,
        business_key: _BusinessKey,
    ) -> list[_CacheDeletePlan]:
        cache_plans: list[_CacheDeletePlan] = []
        for rewrite in rewrites:
            if self._apply:
                session.execute(
                    sa.update(LoadBalancingModelConfig)
                    .where(LoadBalancingModelConfig.id == rewrite.row_id)
                    .values(
                        credential_id=rewrite.new_credential_id,
                        name=rewrite.new_name,
                        encrypted_config=rewrite.new_encrypted_config,
                    )
                )

            self._log_row_updated(
                LoadBalancingModelConfig.__tablename__,
                rewrite.row_id,
                {
                    "credential_id": rewrite.old_credential_id,
                    "encrypted_config": rewrite.old_encrypted_config,
                    "name": rewrite.old_name,
                },
                {
                    "credential_id": rewrite.new_credential_id,
                    "encrypted_config": rewrite.new_encrypted_config,
                    "name": rewrite.new_name,
                },
                tx_id=tx_id,
                business_key=business_key,
                rewrite_source={
                    "rewrite_kind": "credential_reference",
                    "winner_credential_id": winner_credential_id,
                    "loser_credential_ids": list(loser_credential_ids),
                },
            )
            cache_plans.append(
                _CacheDeletePlan(
                    tenant_id=self._tenant_id,
                    identity_id=rewrite.row_id,
                    cache_type=ProviderCredentialsCacheType.LOAD_BALANCING_MODEL,
                    table_name=LoadBalancingModelConfig.__tablename__,
                    row_id=rewrite.row_id,
                    tx_id=tx_id,
                    business_key=business_key,
                )
            )
        return cache_plans

    def _emit_provider_model_credential_group_plan(
        self,
        plan: _ProviderModelCredentialGroupPlan,
        *,
        session: Session,
        tx_id: str,
        business_key: _BusinessKey,
    ) -> None:
        if plan.winner is None:
            return

        loser_credential_ids = [str(row.row.id) for row in plan.loser_rows]
        winner_credential_id = str(plan.winner.row.id)
        cache_plans: list[_CacheDeletePlan] = []
        cache_plans.extend(
            self._emit_provider_model_reference_rewrites(
                session,
                plan.provider_model_rewrites,
                winner_credential_id=winner_credential_id,
                loser_credential_ids=loser_credential_ids,
                tx_id=tx_id,
                business_key=business_key,
            )
        )
        cache_plans.extend(
            self._emit_load_balancing_reference_rewrites(
                session,
                plan.load_balancing_rewrites,
                winner_credential_id=winner_credential_id,
                loser_credential_ids=loser_credential_ids,
                tx_id=tx_id,
                business_key=business_key,
            )
        )

        for loser in plan.loser_rows:
            if self._apply:
                session.execute(
                    sa.delete(ProviderModelCredential).where(ProviderModelCredential.id == str(loser.row.id))
                )
            self._log_row_deleted(
                ProviderModelCredential.__tablename__,
                loser,
                tx_id=tx_id,
                business_key=business_key,
                related_winner_id=winner_credential_id,
            )

        if plan.winner.raw_model_type != plan.winner.canonical_model_type.value:
            if self._apply:
                session.execute(
                    sa.update(ProviderModelCredential)
                    .where(ProviderModelCredential.id == winner_credential_id)
                    .values(model_type=plan.winner.canonical_model_type.value)
                )
            self._log_row_updated(
                ProviderModelCredential.__tablename__,
                winner_credential_id,
                {"model_type": plan.winner.raw_model_type},
                {"model_type": plan.winner.canonical_model_type.value},
                tx_id=tx_id,
                business_key=business_key,
            )

        self._log_cache_plans(cache_plans, apply=self._apply)
        self._log_group_processed(
            ProviderModelCredential.__tablename__,
            business_key,
            plan.group_row_ids,
            tx_id=tx_id,
        )

    def _process_provider_model_credential_group(
        self,
        candidate: _RowWithRawModelType[ProviderModelCredential],
        business_key: _ProviderModelCredentialBusinessKey,
    ) -> list[str]:
        tx_id = self._new_tx_id()
        group_row_ids = [str(candidate.row.id)]

        try:
            with _session_factory(self._engine) as session, session.begin():
                self._configure_lock_timeout(session)
                plan = self._build_provider_model_credential_group_plan(session, candidate, lock_rows=True)
                group_row_ids = plan.group_row_ids or group_row_ids
                self._emit_provider_model_credential_group_plan(
                    plan,
                    session=session,
                    tx_id=tx_id,
                    business_key=business_key,
                )
        except OperationalError as exc:
            if self._is_lock_timeout_error(exc):
                self._log_lock_timeout(
                    ProviderModelCredential.__tablename__,
                    str(candidate.row.id),
                    tx_id,
                    business_key,
                    exc,
                )
                return group_row_ids
            raise

        return group_row_ids

    def _plan_provider_model_reference_rewrites(
        self,
        session: Session,
        winner: _RowWithRawModelType[ProviderModelCredential],
        loser_rows: Sequence[_RowWithRawModelType[ProviderModelCredential]],
        *,
        lock_rows: bool,
    ) -> list[_ProviderModelReferenceRewritePlan]:
        loser_ids = [str(row.row.id) for row in loser_rows]
        if not loser_ids:
            return []

        stmt = (
            select(ProviderModel)
            .where(
                ProviderModel.tenant_id == self._tenant_id,
                ProviderModel.credential_id.in_(loser_ids),
            )
            .order_by(ProviderModel.id.asc())
        )
        if lock_rows:
            stmt = stmt.with_for_update()

        rewrite_plans: list[_ProviderModelReferenceRewritePlan] = []
        provider_models = session.execute(stmt).scalars().all()
        for provider_model in provider_models:
            rewrite_plans.append(
                _ProviderModelReferenceRewritePlan(
                    row_id=str(provider_model.id),
                    old_credential_id=str(provider_model.credential_id),
                    new_credential_id=str(winner.row.id),
                )
            )
        return rewrite_plans

    def _plan_load_balancing_reference_rewrites(
        self,
        session: Session,
        winner: _RowWithRawModelType[ProviderModelCredential],
        loser_rows: Sequence[_RowWithRawModelType[ProviderModelCredential]],
        *,
        lock_rows: bool,
    ) -> list[_LoadBalancingCredentialRewritePlan]:
        loser_ids = [str(row.row.id) for row in loser_rows]
        if not loser_ids:
            return []

        stmt = (
            select(LoadBalancingModelConfig)
            .where(
                LoadBalancingModelConfig.tenant_id == self._tenant_id,
                LoadBalancingModelConfig.credential_id.in_(loser_ids),
            )
            .order_by(LoadBalancingModelConfig.id.asc())
        )
        if lock_rows:
            stmt = stmt.with_for_update()

        winner_credential = winner.row
        winner_credential_id = str(winner_credential.id)
        winner_credential_name = winner_credential.credential_name
        winner_encrypted_config = winner_credential.encrypted_config

        rewrite_plans: list[_LoadBalancingCredentialRewritePlan] = []
        load_balancing_model_configs = session.execute(stmt).scalars().all()
        for load_balancing_model_config in load_balancing_model_configs:
            rewrite_plans.append(
                _LoadBalancingCredentialRewritePlan(
                    row_id=str(load_balancing_model_config.id),
                    old_credential_id=load_balancing_model_config.credential_id,
                    old_name=load_balancing_model_config.name,
                    old_encrypted_config=load_balancing_model_config.encrypted_config,
                    new_credential_id=winner_credential_id,
                    new_name=winner_credential_name,
                    new_encrypted_config=winner_encrypted_config,
                )
            )
        return rewrite_plans

    def _configure_lock_timeout(self, session: Session) -> None:
        dialect_name = session.get_bind().dialect.name
        if dialect_name == "postgresql":
            session.execute(sa.text("SET LOCAL lock_timeout = :timeout"), {"timeout": f"{self._lock_timeout_seconds}s"})
            return
        if dialect_name == "mysql":
            session.execute(
                sa.text("SET SESSION innodb_lock_wait_timeout = :timeout"),
                {"timeout": self._lock_timeout_seconds},
            )
            session.execute(
                sa.text("SET SESSION lock_wait_timeout = :timeout"),
                {"timeout": self._lock_timeout_seconds},
            )

    def _is_lock_timeout_error(self, exc: OperationalError) -> bool:
        orig = exc.orig
        structured_string_codes: set[str] = set()
        structured_int_codes: set[int] = set()

        if orig is not None:
            for raw_code in (
                getattr(orig, "sqlstate", None),
                getattr(orig, "pgcode", None),
                getattr(orig, "code", None),
                getattr(orig, "errno", None),
            ):
                normalized_string_code = _normalize_error_code_string(raw_code)
                if normalized_string_code is not None:
                    structured_string_codes.add(normalized_string_code)

                normalized_int_code = _normalize_error_code_int(raw_code)
                if normalized_int_code is not None:
                    structured_int_codes.add(normalized_int_code)

            raw_args = getattr(orig, "args", None)
            if isinstance(raw_args, tuple | list) and raw_args:
                first_arg = raw_args[0]
                normalized_string_code = _normalize_error_code_string(first_arg)
                if normalized_string_code is not None:
                    structured_string_codes.add(normalized_string_code)

                normalized_int_code = _normalize_error_code_int(first_arg)
                if normalized_int_code is not None:
                    structured_int_codes.add(normalized_int_code)

        if structured_string_codes & _POSTGRES_LOCK_TIMEOUT_SQLSTATES:
            return True
        if structured_int_codes & _MYSQL_LOCK_TIMEOUT_ERRNOS:
            return True

        error_message = str(orig if orig is not None else exc).lower()
        return any(message in error_message for message in _LOCK_TIMEOUT_FALLBACK_MESSAGES)

    def _log_lock_timeout(
        self,
        table_name: str,
        row_id: str,
        tx_id: str,
        business_key: _BusinessKey | None,
        exc: OperationalError,
    ) -> None:
        attrs: dict[str, object] = {
            "tenant_id": self._tenant_id,
            "apply": self._apply,
            "table_name": table_name,
            "id": row_id,
            "tx_id": tx_id,
        }
        if business_key is not None:
            attrs["business_key"] = self._business_key_to_dict(business_key)
        self._log_exception_event(
            "lock_timeout_skipped",
            "Skipped transaction because row lock timed out.",
            attrs,
            exc,
        )

    def _business_key_to_dict(self, business_key: _BusinessKey) -> dict[str, object]:
        return cast(dict[str, object], asdict(business_key))

    def _row_to_dict(self, row: TypeBase, *, raw_model_type: str | None = None) -> dict[str, object]:
        mapper = sa.inspect(row).mapper
        row_dict = {column.key: row.__dict__[column.key] for column in mapper.column_attrs}
        if raw_model_type is not None and "model_type" in row_dict:
            row_dict["model_type"] = raw_model_type
        return _normalize_log_mapping(row_dict)

    def _log_row_deleted[T: TypeBase](
        self,
        table_name: str,
        row: _RowWithRawModelType[T],
        *,
        tx_id: str,
        business_key: _BusinessKey,
        related_winner_id: str,
    ) -> None:
        self._log_event(
            "row_deleted",
            "Deleted loser row during canonicalization.",
            {
                "tenant_id": self._tenant_id,
                "apply": self._apply,
                "table_name": table_name,
                "id": self._row_id(row.row),
                "tx_id": tx_id,
                "business_key": self._business_key_to_dict(business_key),
                "merge_winner_id": related_winner_id,
                "row": self._row_to_dict(row.row, raw_model_type=row.raw_model_type),
            },
        )

    def _log_row_updated(
        self,
        table_name: str,
        row_id: str,
        old_values: dict[str, object],
        new_values: dict[str, object],
        *,
        tx_id: str,
        business_key: _BusinessKey | None = None,
        rewrite_source: dict[str, object] | None = None,
    ) -> None:
        attrs: dict[str, object] = {
            "tenant_id": self._tenant_id,
            "apply": self._apply,
            "table_name": table_name,
            "id": row_id,
            "tx_id": tx_id,
            "old_values": _normalize_log_mapping(old_values),
            "new_values": _normalize_log_mapping(new_values),
        }
        if business_key is not None:
            attrs["business_key"] = self._business_key_to_dict(business_key)
        if rewrite_source is not None:
            attrs["rewrite_source"] = rewrite_source
        self._log_event("row_updated", "Updated row values during canonicalization.", attrs)

    def _log_group_processed(
        self,
        table_name: str,
        business_key: _BusinessKey,
        group_row_ids: Sequence[str],
        *,
        tx_id: str,
    ) -> None:
        self._log_event(
            "group_processed",
            "Processed business-key group during canonicalization.",
            {
                "tenant_id": self._tenant_id,
                "apply": self._apply,
                "table_name": table_name,
                "business_key": self._business_key_to_dict(business_key),
                "group_row_ids": list(group_row_ids),
                "tx_id": tx_id,
            },
        )

    def _log_cache_plans(self, cache_plans: Iterable[_CacheDeletePlan], *, apply: bool) -> None:
        for cache_plan in cache_plans:
            if apply:
                try:
                    ProviderCredentialsCache(
                        tenant_id=cache_plan.tenant_id,
                        identity_id=cache_plan.identity_id,
                        cache_type=cache_plan.cache_type,
                    ).delete()
                    self._log_event(
                        "cache_deleted",
                        "Deleted related cache entry.",
                        {
                            "tenant_id": cache_plan.tenant_id,
                            "apply": apply,
                            "table_name": cache_plan.table_name,
                            "id": cache_plan.row_id,
                            "cache_type": cache_plan.cache_type.value,
                            "tx_id": cache_plan.tx_id,
                            "business_key": self._business_key_to_dict(cache_plan.business_key),
                        },
                    )
                except Exception as exc:
                    self._log_exception_event(
                        "cache_delete_failed",
                        "Failed to delete related cache entry.",
                        {
                            "tenant_id": cache_plan.tenant_id,
                            "apply": apply,
                            "table_name": cache_plan.table_name,
                            "id": cache_plan.row_id,
                            "cache_type": cache_plan.cache_type.value,
                            "tx_id": cache_plan.tx_id,
                            "business_key": self._business_key_to_dict(cache_plan.business_key),
                        },
                        exc,
                    )
            else:
                self._log_event(
                    "cache_delete_planned",
                    "Would delete related cache entry in apply mode.",
                    {
                        "tenant_id": cache_plan.tenant_id,
                        "apply": apply,
                        "table_name": cache_plan.table_name,
                        "id": cache_plan.row_id,
                        "cache_type": cache_plan.cache_type.value,
                        "tx_id": cache_plan.tx_id,
                        "business_key": self._business_key_to_dict(cache_plan.business_key),
                    },
                )

    def _log_exception_event(
        self,
        event: str,
        message: str,
        attrs: dict[str, object],
        exc: BaseException,
    ) -> None:
        self._log_event(
            event,
            message,
            {
                **attrs,
                "error": str(exc),
                "stacktrace": _format_exception_stacktrace(exc),
            },
        )

    def _log_event(self, event: str, message: str, attrs: dict[str, object]) -> None:
        record = {
            "event": event,
            "message": message,
            "attrs": _normalize_log_payload(attrs),
            "ts": naive_utc_now().isoformat(),
        }
        print(json.dumps(record, default=_json_default), file=self._output, flush=True)


def load_tenant_ids_from_file(path: str) -> list[str]:
    """
    Load tenant ids from a plain-text file, one tenant id per line.
    """

    tenant_ids: list[str] = []
    seen_tenant_ids: set[str] = set()
    with open(path, encoding="utf-8") as file:
        for raw_line in file:
            tenant_id = raw_line.strip()
            if not tenant_id or tenant_id in seen_tenant_ids:
                continue
            seen_tenant_ids.add(tenant_id)
            tenant_ids.append(tenant_id)
    return tenant_ids
