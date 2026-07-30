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

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.dataset import Dataset
from models.model import DatasetApiTokenBinding


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
    ids = [str(token_id) for token_id in token_ids]
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
