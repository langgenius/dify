"""Persistence helpers for dataset (knowledge base) API key scoping.

A dataset API key is scoped to specific knowledge bases through
``DatasetApiTokenBinding`` rows:

- no rows  -> the key can access every dataset in its tenant (default / back-compat)
- N rows   -> the key is restricted to exactly those datasets

These helpers live in the service layer so controllers and the service-API auth
decorator can share the queries without embedding SQLAlchemy in controller code.
The caller owns the transaction boundary (commit/flush).
"""

from collections.abc import Iterable

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from models.dataset import Dataset
from models.model import ApiToken, DatasetApiTokenBinding


def get_bound_dataset_ids(session: Session, api_token_id: str) -> set[str]:
    """Return the dataset ids a key is scoped to (empty set means unrestricted)."""
    return {
        str(dataset_id)
        for dataset_id in session.scalars(
            select(DatasetApiTokenBinding.dataset_id).where(DatasetApiTokenBinding.api_token_id == api_token_id)
        ).all()
    }


def list_bindings_by_token(session: Session, token_ids: Iterable[str]) -> dict[str, list[str]]:
    """Group bound dataset ids by api token id for the given tokens."""
    ids = [token_id for token_id in token_ids]
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
    existing = {
        str(dataset_id)
        for dataset_id in session.scalars(
            select(Dataset.id).where(Dataset.id.in_(dataset_ids), Dataset.tenant_id == tenant_id)
        ).all()
    }
    return [dataset_id for dataset_id in dataset_ids if dataset_id not in existing]


def bind_datasets(session: Session, api_token_id: str, dataset_ids: Iterable[str]) -> None:
    """Add one binding row per dataset id. The caller controls the transaction."""
    for dataset_id in dataset_ids:
        session.add(DatasetApiTokenBinding(api_token_id=api_token_id, dataset_id=dataset_id))


def delete_keys_scoped_only_to(session: Session, dataset_id: str) -> list[str]:
    """Delete dataset API keys whose only binding is ``dataset_id``.

    A deleted knowledge base cascades its bindings away. A key bound solely to it
    would otherwise drop to zero bindings and silently become unrestricted
    (access-all) under the "no bindings = access all" rule. To keep scope from
    escalating, delete those keys (their remaining rows cascade with the token).
    Keys also bound to other datasets keep those bindings and survive.

    Must run before the dataset row is deleted (so the bindings still exist).
    Returns the deleted api_token ids; the caller controls the transaction.
    """
    orphan_ids = [
        str(token_id)
        for token_id in session.scalars(
            select(DatasetApiTokenBinding.api_token_id)
            .where(DatasetApiTokenBinding.dataset_id == dataset_id)
            .where(
                DatasetApiTokenBinding.api_token_id.notin_(
                    select(DatasetApiTokenBinding.api_token_id).where(DatasetApiTokenBinding.dataset_id != dataset_id)
                )
            )
        ).all()
    ]
    if orphan_ids:
        session.execute(delete(ApiToken).where(ApiToken.id.in_(orphan_ids)))
    return orphan_ids
