"""Persistence helpers for dataset (knowledge base) API key scoping.

A dataset API key is scoped to specific knowledge bases through
``DatasetApiTokenBinding`` rows:

- no rows  -> the key can access every dataset in its tenant (default / back-compat)
- N rows   -> the key is restricted to exactly those datasets

Shared by key management, dataset deletion, and service-API authentication.
The caller owns the transaction boundary (commit/flush).
"""

from collections.abc import Iterable

from sqlalchemy import Select, delete, select
from sqlalchemy.orm import Session

from models.dataset import Dataset
from models.enums import ApiTokenType
from models.model import ApiToken, DatasetApiTokenBinding


def get_bound_dataset_ids(session: Session, api_token_id: str) -> set[str]:
    """Return the dataset ids a key is scoped to (empty set means unrestricted)."""
    return set(
        session.scalars(
            select(DatasetApiTokenBinding.dataset_id).where(DatasetApiTokenBinding.api_token_id == api_token_id)
        ).all()
    )


def list_bindings_by_token(session: Session, token_ids: Iterable[str]) -> dict[str, list[str]]:
    """Group bound dataset ids by api token id for the given tokens."""
    ids = list(token_ids)
    bindings_by_token: dict[str, list[str]] = {}
    if not ids:
        return bindings_by_token
    rows = session.execute(
        select(DatasetApiTokenBinding.api_token_id, DatasetApiTokenBinding.dataset_id).where(
            DatasetApiTokenBinding.api_token_id.in_(ids)
        )
    ).all()
    for token_id, dataset_id in rows:
        bindings_by_token.setdefault(str(token_id), []).append(str(dataset_id))
    return bindings_by_token


def find_unknown_dataset_ids(session: Session, dataset_ids: list[str], tenant_id: str) -> list[str]:
    """Return the dataset ids that do not belong to the tenant (preserving order)."""
    if not dataset_ids:
        return []
    existing = set(
        session.scalars(select(Dataset.id).where(Dataset.id.in_(dataset_ids), Dataset.tenant_id == tenant_id)).all()
    )
    return [dataset_id for dataset_id in dataset_ids if dataset_id not in existing]


def bind_datasets(session: Session, api_token_id: str, dataset_ids: Iterable[str]) -> None:
    """Add one binding row per dataset id. The caller controls the transaction."""
    for dataset_id in dataset_ids:
        session.add(DatasetApiTokenBinding(api_token_id=api_token_id, dataset_id=dataset_id))


def _tokens_for_cleanup(*, tenant_id: str) -> Select[tuple[ApiToken]]:
    return (
        select(ApiToken)
        .where(
            ApiToken.tenant_id == tenant_id,
            ApiToken.type == ApiTokenType.DATASET,
        )
        .order_by(ApiToken.id)
        .with_for_update()
    )


def _bindings_for_current_scope(locked_key_ids: tuple[str, ...]) -> Select[tuple[str, str]]:
    return (
        select(DatasetApiTokenBinding.api_token_id, DatasetApiTokenBinding.dataset_id)
        .where(DatasetApiTokenBinding.api_token_id.in_(locked_key_ids))
        .order_by(DatasetApiTokenBinding.api_token_id, DatasetApiTokenBinding.dataset_id)
        .with_for_update()
    )


def delete_keys_scoped_only_to(session: Session, dataset_id: str, *, tenant_id: str) -> list[str]:
    """Delete dataset API keys whose only binding is ``dataset_id``.

    A deleted knowledge base cascades its bindings away. A key bound solely to it
    would otherwise drop to zero bindings and silently become unrestricted
    (access-all) under the "no bindings = access all" rule. To keep scope from
    escalating, delete those keys (their remaining rows cascade with the token).
    Keys also bound to other datasets keep those bindings and survive.

    Must run before the dataset row is deleted (so the bindings still exist).
    Returns revoked token values for post-commit cache invalidation. Lock every
    affected key before inspecting its bindings so concurrent dataset deletions
    cannot both leave the same key with zero bindings.
    """
    # Lock every dataset token in the tenant without joining its bindings. The
    # locking read is current on MySQL and its tenant/type range lock also
    # serializes a concurrent key insert. Starting from a plain binding query
    # would be unsafe when the caller already owns an older REPEATABLE READ
    # snapshot: a newly committed binding could be omitted and then cascaded
    # away with the dataset, leaving its key unrestricted.
    bound_keys = session.scalars(_tokens_for_cleanup(tenant_id=tenant_id)).all()
    locked_key_ids = tuple(key.id for key in bound_keys)
    if not locked_key_ids:
        return []

    # This must be a locking current read. A normal SELECT can reuse an older
    # REPEATABLE READ snapshot established by the caller before it waited for
    # the token lock, missing a binding deleted by the transaction that won the
    # lock. Both concurrent dataset deletions could then preserve the key and
    # leave it with zero bindings, which means unrestricted access.
    binding_rows = session.execute(_bindings_for_current_scope(locked_key_ids)).all()
    scopes_by_key: dict[str, set[str]] = {key_id: set() for key_id in locked_key_ids}
    for key_id, bound_dataset_id in binding_rows:
        scopes_by_key[str(key_id)].add(str(bound_dataset_id))
    orphan_ids = {key_id for key_id, scope in scopes_by_key.items() if scope == {dataset_id}}
    if orphan_ids:
        session.execute(
            delete(ApiToken).where(
                ApiToken.id.in_(orphan_ids), ApiToken.tenant_id == tenant_id, ApiToken.type == ApiTokenType.DATASET
            )
        )
    return [key.token for key in bound_keys if key.id in orphan_ids]


def token_ids_scoped_only_to(dataset_id: str) -> Select[tuple[str]]:
    """Select keys bound only to one dataset, for management and deletion."""
    return select(DatasetApiTokenBinding.api_token_id).where(
        DatasetApiTokenBinding.dataset_id == dataset_id,
        DatasetApiTokenBinding.api_token_id.notin_(
            select(DatasetApiTokenBinding.api_token_id).where(DatasetApiTokenBinding.dataset_id != dataset_id)
        ),
    )
