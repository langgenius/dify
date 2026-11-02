"""Embedding availability rules shared by dataset responses and list filters.

A knowledge base is available when its indexing technique needs no embedding
model, or when the embedding model stored on it is one of the workspace's active
text embedding models. One predicate decides both the ``embedding_available``
flag on a list card and the availability filter, so a filtered list can never
disagree with the badge a card shows.

Callers pass ``embedding_model_provider`` in the canonical
``$organization/$plugin_name/$provider_name`` form that list responses use.
Persistence adapters canonicalize a stored provider before evaluating the rule.
"""

from core.rag.index_processor.constant.index_type import IndexTechniqueType


def is_embedding_available(
    *,
    indexing_technique: str | None,
    embedding_model: str | None,
    embedding_model_provider: str | None,
    embedding_models: set[str],
    listing: bool,
) -> bool:
    """Return whether a dataset's embedding configuration is usable.

    Preconditions: ``embedding_model_provider`` is already canonical and
    ``embedding_models`` holds ``"<model>:<provider>"`` keys for the workspace's
    active text embedding models. ``listing`` selects the list rule, where a
    high-quality row without a stored provider counts as available because
    listing has no model key to compare against.
    Postconditions: true when the indexing technique needs no embedding model or
    the stored model key is active; false otherwise. No state is mutated.
    """
    if indexing_technique != IndexTechniqueType.HIGH_QUALITY:
        return True
    if not embedding_model_provider:
        return listing
    return f"{embedding_model}:{embedding_model_provider}" in embedding_models
