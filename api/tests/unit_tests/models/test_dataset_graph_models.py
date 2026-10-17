"""Knowledge-graph rows identify themselves by what they hold, not only their id."""

from models.dataset import (
    DatasetGraphChunkLink,
    DatasetGraphEntity,
    DatasetGraphExtractionFailure,
    DatasetGraphRelation,
)


def test_graph_rows_show_their_content_in_logs() -> None:
    entity = DatasetGraphEntity(
        tenant_id="tenant", dataset_id="dataset", name="acme", display_name="Acme", entity_type="organization"
    )
    relation = DatasetGraphRelation(
        tenant_id="tenant",
        dataset_id="dataset",
        source_entity_id=entity.id,
        target_entity_id=entity.id,
        predicate="owns",
    )
    link = DatasetGraphChunkLink(tenant_id="tenant", dataset_id="dataset", document_id="document", index_node_id="node")
    failure = DatasetGraphExtractionFailure(
        tenant_id="tenant", dataset_id="dataset", document_id="document", index_node_id="node", error="503"
    )

    assert repr(entity) == f"<DatasetGraphEntity id={entity.id} name=acme type=organization>"
    assert repr(relation) == f"<DatasetGraphRelation id={relation.id} predicate=owns>"
    assert repr(link) == f"<DatasetGraphChunkLink id={link.id} index_node_id=node>"
    assert repr(failure) == f"<DatasetGraphExtractionFailure id={failure.id} index_node_id=node>"
