"""Persistence helpers for dataset (knowledge base) API key scoping.

A dataset API key is scoped to specific knowledge bases through
``DatasetApiTokenBinding`` rows. Legacy knowledge bases (``datasets``) and
KnowledgeFS spaces (``knowledge_fs_control_spaces``) live in different tables, so
every row records which kind of resource it points at:

- ``resource_type = "dataset"``            -> ``dataset_id`` (legacy ``Dataset``)
- ``resource_type = "knowledge_fs_space"`` -> ``control_space_id`` (KnowledgeFS space)

Scope semantics:

- no rows  -> the key can access every knowledge base in its tenant (default / back-compat)
- N rows   -> the key is restricted to exactly those resources. Each service-API surface
              only honours bindings of its own kind: the legacy dataset endpoints check
              ``dataset_id`` bindings and the KnowledgeFS endpoints check
              ``control_space_id`` bindings, so a key bound solely to one kind is
              rejected by the other.

These helpers live in the service layer so controllers and the service-API auth
gates can share the queries without embedding SQLAlchemy in controller code.
The caller owns the transaction boundary (commit/flush).
"""

from collections.abc import Iterable
from dataclasses import dataclass, field

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from models.dataset import Dataset
from models.enums import ApiTokenBindingResourceType
from models.knowledge_fs import KnowledgeFSControlSpace, KnowledgeFSControlSpaceState
from models.model import ApiToken, DatasetApiTokenBinding

_UNBINDABLE_SPACE_STATES = (KnowledgeFSControlSpaceState.DELETING, KnowledgeFSControlSpaceState.DELETED)


@dataclass(frozen=True)
class ApiKeyScope:
    """The knowledge bases a dataset API key may reach (empty = unrestricted)."""

    dataset_ids: frozenset[str] = frozenset()
    knowledge_space_ids: frozenset[str] = frozenset()

    @property
    def restricted(self) -> bool:
        return bool(self.dataset_ids or self.knowledge_space_ids)

    def allows_dataset(self, dataset_id: str | None) -> bool:
        """Legacy dataset endpoints: unrestricted keys pass; bound keys need a bound dataset id."""
        if not self.restricted:
            return True
        return dataset_id is not None and str(dataset_id) in self.dataset_ids

    def allows_knowledge_space(self, control_space_id: str | None) -> bool:
        """KnowledgeFS endpoints: unrestricted keys pass; bound keys need a bound space id."""
        if not self.restricted:
            return True
        return control_space_id is not None and str(control_space_id) in self.knowledge_space_ids


@dataclass
class ApiKeyBindings:
    """Bound resource ids of one key, in insertion order, for console responses."""

    dataset_ids: list[str] = field(default_factory=list)
    knowledge_space_ids: list[str] = field(default_factory=list)


def _binding_columns():
    return (
        DatasetApiTokenBinding.api_token_id,
        DatasetApiTokenBinding.resource_type,
        DatasetApiTokenBinding.dataset_id,
        DatasetApiTokenBinding.control_space_id,
    )


def _classify(resource_type: object, dataset_id: object, control_space_id: object) -> tuple[str, str] | None:
    """Map one binding row to ``("dataset" | "knowledge_fs_space", resource_id)``."""
    if resource_type == ApiTokenBindingResourceType.KNOWLEDGE_FS_SPACE:
        if not control_space_id:
            return None
        return ApiTokenBindingResourceType.KNOWLEDGE_FS_SPACE.value, str(control_space_id)
    if not dataset_id:
        return None
    return ApiTokenBindingResourceType.DATASET.value, str(dataset_id)


def get_key_scope(session: Session, api_token_id: str) -> ApiKeyScope:
    """Return the resources a key is scoped to (both empty means unrestricted)."""
    dataset_ids: set[str] = set()
    knowledge_space_ids: set[str] = set()
    rows = session.execute(select(*_binding_columns()).where(DatasetApiTokenBinding.api_token_id == api_token_id)).all()
    for _token_id, resource_type, dataset_id, control_space_id in rows:
        classified = _classify(resource_type, dataset_id, control_space_id)
        if classified is None:
            continue
        kind, resource_id = classified
        if kind == ApiTokenBindingResourceType.KNOWLEDGE_FS_SPACE.value:
            knowledge_space_ids.add(resource_id)
        else:
            dataset_ids.add(resource_id)
    return ApiKeyScope(dataset_ids=frozenset(dataset_ids), knowledge_space_ids=frozenset(knowledge_space_ids))


def get_bound_dataset_ids(session: Session, api_token_id: str) -> set[str]:
    """Return the legacy dataset ids a key is scoped to.

    Prefer :func:`get_key_scope`: an empty result here does not mean the key is
    unrestricted, because it may still be bound to KnowledgeFS spaces.
    """
    return set(get_key_scope(session, api_token_id).dataset_ids)


def list_bindings_by_token(session: Session, token_ids: Iterable[str]) -> dict[str, ApiKeyBindings]:
    """Group bound resource ids by api token id for the given tokens."""
    ids = [str(token_id) for token_id in token_ids]
    bindings_by_token: dict[str, ApiKeyBindings] = {}
    if not ids:
        return bindings_by_token
    rows = session.execute(select(*_binding_columns()).where(DatasetApiTokenBinding.api_token_id.in_(ids))).all()
    for token_id, resource_type, dataset_id, control_space_id in rows:
        classified = _classify(resource_type, dataset_id, control_space_id)
        if classified is None:
            continue
        kind, resource_id = classified
        bindings = bindings_by_token.setdefault(str(token_id), ApiKeyBindings())
        if kind == ApiTokenBindingResourceType.KNOWLEDGE_FS_SPACE.value:
            bindings.knowledge_space_ids.append(resource_id)
        else:
            bindings.dataset_ids.append(resource_id)
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


def find_unknown_knowledge_space_ids(session: Session, control_space_ids: list[str], tenant_id: str) -> list[str]:
    """Return the KnowledgeFS space ids that are not bindable in the tenant (preserving order).

    A space that is being deleted or already deleted is treated as unknown so a new
    key cannot be scoped to it.
    """
    if not control_space_ids:
        return []
    existing = {
        str(control_space_id)
        for control_space_id in session.scalars(
            select(KnowledgeFSControlSpace.id).where(
                KnowledgeFSControlSpace.id.in_(control_space_ids),
                KnowledgeFSControlSpace.tenant_id == tenant_id,
                KnowledgeFSControlSpace.state.notin_(_UNBINDABLE_SPACE_STATES),
            )
        ).all()
    }
    return [control_space_id for control_space_id in control_space_ids if control_space_id not in existing]


def bind_datasets(session: Session, api_token_id: str, dataset_ids: Iterable[str]) -> None:
    """Add one legacy-dataset binding row per dataset id. The caller controls the transaction."""
    for dataset_id in dataset_ids:
        session.add(
            DatasetApiTokenBinding(
                api_token_id=api_token_id,
                resource_type=ApiTokenBindingResourceType.DATASET,
                dataset_id=dataset_id,
            )
        )


def bind_knowledge_spaces(session: Session, api_token_id: str, control_space_ids: Iterable[str]) -> None:
    """Add one KnowledgeFS-space binding row per control space id. The caller controls the transaction."""
    for control_space_id in control_space_ids:
        session.add(
            DatasetApiTokenBinding(
                api_token_id=api_token_id,
                resource_type=ApiTokenBindingResourceType.KNOWLEDGE_FS_SPACE,
                control_space_id=control_space_id,
            )
        )


def _delete_keys_bound_only_to(session: Session, *, is_target_binding, is_other_binding) -> list[str]:
    """Delete keys whose every binding matches ``is_target_binding``.

    ``is_other_binding`` must select bindings that keep a key alive (any binding to a
    different resource, of either kind). NULL-safe: a binding of the other kind has a
    NULL id column for the target kind and must still count as "other".
    """
    orphan_ids = [
        str(token_id)
        for token_id in session.scalars(
            select(DatasetApiTokenBinding.api_token_id)
            .where(is_target_binding)
            .where(
                DatasetApiTokenBinding.api_token_id.notin_(
                    select(DatasetApiTokenBinding.api_token_id).where(is_other_binding)
                )
            )
        ).all()
    ]
    if orphan_ids:
        session.execute(delete(ApiToken).where(ApiToken.id.in_(orphan_ids)))
    return orphan_ids


def delete_keys_scoped_only_to(session: Session, dataset_id: str) -> list[str]:
    """Delete dataset API keys whose only binding is ``dataset_id``.

    A deleted knowledge base cascades its bindings away. A key bound solely to it
    would otherwise drop to zero bindings and silently become unrestricted
    (access-all) under the "no bindings = access all" rule. To keep scope from
    escalating, delete those keys (their remaining rows cascade with the token).
    Keys also bound to other datasets or to KnowledgeFS spaces keep those bindings
    and survive.

    Must run before the dataset row is deleted (so the bindings still exist).
    Returns the deleted api_token ids; the caller controls the transaction.
    """
    return _delete_keys_bound_only_to(
        session,
        is_target_binding=DatasetApiTokenBinding.dataset_id == dataset_id,
        is_other_binding=or_(
            DatasetApiTokenBinding.dataset_id.is_(None),
            DatasetApiTokenBinding.dataset_id != dataset_id,
        ),
    )


def delete_keys_scoped_only_to_knowledge_space(session: Session, control_space_id: str) -> list[str]:
    """Delete dataset API keys whose only binding is the KnowledgeFS space ``control_space_id``.

    KnowledgeFS spaces are soft-deleted (the control-space row survives in state
    ``deleted``), so their bindings never cascade away on their own. Keys bound
    solely to the space are deleted for the same reason as
    :func:`delete_keys_scoped_only_to`; the space's remaining bindings (on keys that
    are also bound elsewhere) are removed so they stop counting toward the key's scope.
    Returns the deleted api_token ids; the caller controls the transaction.
    """
    orphan_ids = _delete_keys_bound_only_to(
        session,
        is_target_binding=DatasetApiTokenBinding.control_space_id == control_space_id,
        is_other_binding=or_(
            DatasetApiTokenBinding.control_space_id.is_(None),
            DatasetApiTokenBinding.control_space_id != control_space_id,
        ),
    )
    session.execute(delete(DatasetApiTokenBinding).where(DatasetApiTokenBinding.control_space_id == control_space_id))
    return orphan_ids
