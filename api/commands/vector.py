import json
from collections.abc import Sequence
from typing import cast

import click
from flask import current_app
from flask.cli import with_appcontext
from sqlalchemy import select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.index_processor.constant.built_in_field import BuiltInField
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from core.rag.models.document import Document
from extensions.ext_database import db
from libs.pagination import paginate_query
from models.dataset import (
    ChildChunk,
    Dataset,
    DatasetCollectionBinding,
    DatasetMetadata,
    DatasetMetadataBinding,
    DocumentSegment,
    DocumentSegmentSummary,
)
from models.dataset import Document as DatasetDocument
from models.enums import DatasetMetadataType, IndexingStatus, SegmentStatus, SummaryStatus
from models.model import App, AppAnnotationSetting, MessageAnnotation


@click.command("vdb-migrate", help="Migrate vector db.")
@click.option("--scope", default="all", prompt=False, help="The scope of vector database to migrate, Default is All.")
@with_appcontext
def vdb_migrate(scope: str):
    if scope in {"knowledge", "all"}:
        migrate_knowledge_vector_database()
    if scope in {"annotation", "all"}:
        migrate_annotation_vector_database()


def migrate_annotation_vector_database():
    """
    Migrate annotation data to target vector database.
    """
    click.echo(click.style("Starting annotation data migration.", fg="green"))
    create_count = 0
    skipped_count = 0
    total_count = 0
    page = 1
    while True:
        try:
            # get apps info
            per_page = 50
            with sessionmaker(db.engine, expire_on_commit=False).begin() as session:
                apps = session.scalars(
                    select(App)
                    .where(App.status == "normal")
                    .order_by(App.created_at.desc())
                    .limit(per_page)
                    .offset((page - 1) * per_page)
                ).all()
            if not apps:
                break
        except SQLAlchemyError:
            raise

        page += 1
        for app in apps:
            total_count = total_count + 1
            click.echo(
                f"Processing the {total_count} app {app.id}. " + f"{create_count} created, {skipped_count} skipped."
            )
            try:
                click.echo(f"Creating app annotation index: {app.id}")
                with sessionmaker(db.engine, expire_on_commit=False).begin() as session:
                    app_annotation_setting = session.scalar(
                        select(AppAnnotationSetting).where(AppAnnotationSetting.app_id == app.id).limit(1)
                    )

                    if not app_annotation_setting:
                        skipped_count = skipped_count + 1
                        click.echo(f"App annotation setting disabled: {app.id}")
                        continue
                    # get dataset_collection_binding info
                    dataset_collection_binding = session.scalar(
                        select(DatasetCollectionBinding).where(
                            DatasetCollectionBinding.id == app_annotation_setting.collection_binding_id
                        )
                    )
                    if not dataset_collection_binding:
                        click.echo(f"App annotation collection binding not found: {app.id}")
                        continue
                    annotations = session.scalars(
                        select(MessageAnnotation).where(MessageAnnotation.app_id == app.id)
                    ).all()
                dataset = Dataset(
                    id=app.id,
                    tenant_id=app.tenant_id,
                    indexing_technique=IndexTechniqueType.HIGH_QUALITY,
                    embedding_model_provider=dataset_collection_binding.provider_name,
                    embedding_model=dataset_collection_binding.model_name,
                    collection_binding_id=dataset_collection_binding.id,
                )
                documents = []
                if annotations:
                    for annotation in annotations:
                        document = Document(
                            page_content=annotation.question_text,
                            metadata={"annotation_id": annotation.id, "app_id": app.id, "doc_id": annotation.id},
                        )
                        documents.append(document)

                vector = Vector(dataset, attributes=["doc_id", "annotation_id", "app_id"])
                click.echo(f"Migrating annotations for app: {app.id}.")

                try:
                    vector.delete()
                    click.echo(click.style(f"Deleted vector index for app {app.id}.", fg="green"))
                except Exception as e:
                    click.echo(click.style(f"Failed to delete vector index for app {app.id}.", fg="red"))
                    raise e
                if documents:
                    try:
                        click.echo(
                            click.style(
                                f"Creating vector index with {len(documents)} annotations for app {app.id}.",
                                fg="green",
                            )
                        )
                        vector.create(documents)
                        click.echo(click.style(f"Created vector index for app {app.id}.", fg="green"))
                    except Exception as e:
                        click.echo(click.style(f"Failed to created vector index for app {app.id}.", fg="red"))
                        raise e
                click.echo(f"Successfully migrated app annotation {app.id}.")
                create_count += 1
            except Exception as e:
                click.echo(
                    click.style(f"Error creating app annotation index: {e.__class__.__name__} {str(e)}", fg="red")
                )
                continue

    click.echo(
        click.style(
            f"Migration complete. Created {create_count} app annotation indexes. Skipped {skipped_count} apps.",
            fg="green",
        )
    )


def _collect_dataset_vector_documents(
    dataset: Dataset,
    *,
    session: Session,
) -> tuple[list[Document], int]:
    """Snapshot the canonical vector payload while the read transaction is open."""
    dataset_documents = session.scalars(
        select(DatasetDocument).where(
            DatasetDocument.tenant_id == dataset.tenant_id,
            DatasetDocument.dataset_id == dataset.id,
            DatasetDocument.indexing_status == IndexingStatus.COMPLETED,
            DatasetDocument.enabled == True,
            DatasetDocument.archived == False,
        )
    ).all()

    documents: list[Document] = []
    segments_count = 0
    for dataset_document in dataset_documents:
        segments = session.scalars(
            select(DocumentSegment).where(
                DocumentSegment.tenant_id == dataset.tenant_id,
                DocumentSegment.document_id == dataset_document.id,
                DocumentSegment.dataset_id == dataset.id,
                DocumentSegment.status == SegmentStatus.COMPLETED,
                DocumentSegment.enabled == True,
            )
        ).all()
        segment_ids = [segment.id for segment in segments]
        summaries = (
            session.scalars(
                select(DocumentSegmentSummary)
                .where(
                    DocumentSegmentSummary.dataset_id == dataset.id,
                    DocumentSegmentSummary.document_id == dataset_document.id,
                    DocumentSegmentSummary.chunk_id.in_(segment_ids),
                )
                .order_by(
                    DocumentSegmentSummary.chunk_id,
                    DocumentSegmentSummary.updated_at.desc(),
                    DocumentSegmentSummary.id.desc(),
                )
            ).all()
            if segment_ids
            else []
        )
        canonical_summaries: dict[str, DocumentSegmentSummary] = {}
        for summary_record in summaries:
            canonical_summaries.setdefault(summary_record.chunk_id, summary_record)

        for segment in segments:
            base_metadata = {
                "doc_id": segment.index_node_id,
                "doc_hash": segment.index_node_hash,
                "document_id": segment.document_id,
                "dataset_id": segment.dataset_id,
                "doc_type": DocType.TEXT,
                "is_summary": False,
            }
            if dataset_document.doc_form == IndexStructureType.PARENT_CHILD_INDEX:
                child_chunks = session.scalars(
                    select(ChildChunk)
                    .where(
                        ChildChunk.tenant_id == dataset.tenant_id,
                        ChildChunk.dataset_id == dataset.id,
                        ChildChunk.document_id == dataset_document.id,
                        ChildChunk.segment_id == segment.id,
                    )
                    .order_by(ChildChunk.position)
                ).all()
                for child_chunk in child_chunks:
                    documents.append(
                        Document(
                            page_content=child_chunk.content,
                            metadata={
                                "doc_id": child_chunk.index_node_id,
                                "doc_hash": child_chunk.index_node_hash,
                                "document_id": segment.document_id,
                                "dataset_id": segment.dataset_id,
                                "doc_type": DocType.TEXT,
                                "is_summary": False,
                            },
                        )
                    )
            elif segment.index_node_id:
                documents.append(Document(page_content=segment.content, metadata=base_metadata))

            summary = canonical_summaries.get(segment.id)
            if (
                summary is not None
                and summary.status == SummaryStatus.COMPLETED
                and summary.enabled
                and summary.summary_content
                and summary.summary_index_node_id
            ):
                documents.append(
                    Document(
                        page_content=summary.summary_content,
                        metadata={
                            "doc_id": summary.summary_index_node_id,
                            "doc_hash": summary.summary_index_node_hash,
                            "document_id": segment.document_id,
                            "dataset_id": segment.dataset_id,
                            "original_chunk_id": segment.id,
                            "doc_type": DocType.TEXT,
                            "is_summary": True,
                        },
                    )
                )
            segments_count += 1

    return documents, segments_count


def _vector_documents_signature(documents: Sequence[Document]) -> tuple[tuple[str, ...], ...]:
    """Return a stable signature for detecting relational changes during vector I/O."""
    return tuple(
        sorted(
            (
                type(document).__name__,
                document.page_content,
                str(document.metadata.get("doc_id") or ""),
                str(document.metadata.get("doc_hash") or ""),
                str(document.metadata.get("document_id") or ""),
                str(document.metadata.get("dataset_id") or ""),
                str(document.metadata.get("original_chunk_id") or ""),
                str(document.metadata.get("doc_type") or ""),
                str(bool(document.metadata.get("is_summary"))),
            )
            for document in documents
        )
    )


def migrate_knowledge_vector_database():
    """Migrate each high-quality dataset to the configured vector provider.

    Relational payloads are copied inside short read transactions; vector I/O
    never owns a database connection. Before activation, the payload is read
    again in the activation transaction and the dataset pointer is compare-and-swap
    updated together with every setting that selected the target collection or
    embedding space. This detects changes committed during provider I/O.
    Cross-store atomicity is impossible here, so operators must quiesce dataset
    writes to eliminate the final concurrent-write window.
    """
    click.echo(click.style("Starting vector database migration.", fg="green"))
    create_count = 0
    skipped_count = 0
    total_count = 0
    vector_type = dify_config.VECTOR_STORE
    upper_collection_vector_types = {
        VectorType.MILVUS,
        VectorType.PGVECTOR,
        VectorType.VASTBASE,
        VectorType.RELYT,
        VectorType.WEAVIATE,
        VectorType.ORACLE,
        VectorType.ELASTICSEARCH,
        VectorType.OPENGAUSS,
        VectorType.TABLESTORE,
        VectorType.MATRIXONE,
    }
    lower_collection_vector_types = {
        VectorType.ANALYTICDB,
        VectorType.HOLOGRES,
        VectorType.CHROMA,
        VectorType.MYSCALE,
        VectorType.PGVECTO_RS,
        VectorType.TIDB_VECTOR,
        VectorType.OPENSEARCH,
        VectorType.TENCENT,
        VectorType.BAIDU,
        VectorType.VIKINGDB,
        VectorType.UPSTASH,
        VectorType.COUCHBASE,
        VectorType.OCEANBASE,
    }
    page = 1
    session_maker = sessionmaker(db.engine, expire_on_commit=False)
    while True:
        try:
            stmt = (
                select(Dataset)
                .where(Dataset.indexing_technique == IndexTechniqueType.HIGH_QUALITY)
                .order_by(Dataset.created_at.desc())
            )
            with session_maker() as read_session:
                dataset_page = paginate_query(stmt, page=page, per_page=50, max_per_page=50, session=read_session)
                datasets = list(dataset_page.items)
            if not datasets:
                break
        except SQLAlchemyError:
            raise

        page += 1
        for dataset in datasets:
            total_count = total_count + 1
            click.echo(
                f"Processing the {total_count} dataset {dataset.id}. {create_count} created, {skipped_count} skipped."
            )
            try:
                click.echo(f"Creating dataset vector database index: {dataset.id}")
                source_index_struct = dataset.index_struct
                source_provider = dataset.provider
                source_indexing_technique = dataset.indexing_technique
                source_embedding_model = dataset.embedding_model
                source_embedding_model_provider = dataset.embedding_model_provider
                source_collection_binding_id = dataset.collection_binding_id
                if dataset.index_struct_dict:
                    if dataset.index_struct_dict["type"] == vector_type:
                        skipped_count = skipped_count + 1
                        continue
                collection_name = ""
                dataset_id = dataset.id
                if vector_type in upper_collection_vector_types:
                    collection_name = Dataset.gen_collection_name_by_id(dataset_id)
                elif vector_type == VectorType.QDRANT:
                    if dataset.collection_binding_id:
                        with session_maker() as read_session:
                            dataset_collection_binding = read_session.scalar(
                                select(DatasetCollectionBinding).where(
                                    DatasetCollectionBinding.id == dataset.collection_binding_id
                                )
                            )
                        if dataset_collection_binding:
                            collection_name = dataset_collection_binding.collection_name
                        else:
                            raise ValueError("Dataset Collection Binding not found")
                    else:
                        collection_name = Dataset.gen_collection_name_by_id(dataset_id)

                elif vector_type in lower_collection_vector_types:
                    collection_name = Dataset.gen_collection_name_by_id(dataset_id).lower()
                else:
                    raise ValueError(f"Vector store {vector_type} is not supported.")

                index_struct_dict = {"type": vector_type, "vector_store": {"class_prefix": collection_name}}
                dataset.index_struct = json.dumps(index_struct_dict)
                with session_maker() as read_session:
                    documents, segments_count = _collect_dataset_vector_documents(dataset, session=read_session)
                source_signature = _vector_documents_signature(documents)

                # All relational state is now copied to plain RAG documents and the read transaction is closed.
                vector = Vector(dataset)
                click.echo(f"Migrating dataset {dataset.id}.")

                try:
                    vector.delete()
                    click.echo(
                        click.style(f"Deleted vector index {collection_name} for dataset {dataset.id}.", fg="green")
                    )
                except Exception as e:
                    click.echo(
                        click.style(
                            f"Failed to delete vector index {collection_name} for dataset {dataset.id}.", fg="red"
                        )
                    )
                    raise e

                if documents:
                    try:
                        click.echo(
                            click.style(
                                f"Creating vector index with {len(documents)} documents of {segments_count}"
                                f" segments for dataset {dataset.id}.",
                                fg="green",
                            )
                        )
                        vector.create(documents)
                        click.echo(click.style(f"Created vector index for dataset {dataset.id}.", fg="green"))
                    except Exception as e:
                        click.echo(click.style(f"Failed to created vector index for dataset {dataset.id}.", fg="red"))
                        raise e
                source_index_condition = (
                    Dataset.index_struct.is_(None)
                    if source_index_struct is None
                    else Dataset.index_struct == source_index_struct
                )
                source_embedding_model_condition = (
                    Dataset.embedding_model.is_(None)
                    if source_embedding_model is None
                    else Dataset.embedding_model == source_embedding_model
                )
                source_embedding_model_provider_condition = (
                    Dataset.embedding_model_provider.is_(None)
                    if source_embedding_model_provider is None
                    else Dataset.embedding_model_provider == source_embedding_model_provider
                )
                source_collection_binding_condition = (
                    Dataset.collection_binding_id.is_(None)
                    if source_collection_binding_id is None
                    else Dataset.collection_binding_id == source_collection_binding_id
                )
                with session_maker.begin() as write_session:
                    current_documents, current_segments_count = _collect_dataset_vector_documents(
                        dataset, session=write_session
                    )
                    if (
                        current_segments_count != segments_count
                        or _vector_documents_signature(current_documents) != source_signature
                    ):
                        raise RuntimeError(
                            f"Dataset {dataset.id} changed while its vector index was being migrated; "
                            "the database pointer was not updated"
                        )
                    update_result = cast(
                        CursorResult,
                        write_session.execute(
                            update(Dataset)
                            .where(
                                Dataset.id == dataset.id,
                                Dataset.tenant_id == dataset.tenant_id,
                                source_index_condition,
                                Dataset.provider == source_provider,
                                Dataset.indexing_technique == source_indexing_technique,
                                source_embedding_model_condition,
                                source_embedding_model_provider_condition,
                                source_collection_binding_condition,
                            )
                            .values(index_struct=dataset.index_struct)
                        ),
                    )
                    if update_result.rowcount != 1:
                        raise RuntimeError(
                            f"Dataset {dataset.id} vector configuration changed concurrently; "
                            "the migration result was not activated"
                        )
                click.echo(f"Successfully migrated dataset {dataset.id}.")
                create_count += 1
            except Exception as e:
                click.echo(click.style(f"Error creating dataset index: {e.__class__.__name__} {str(e)}", fg="red"))
                continue

    click.echo(
        click.style(
            f"Migration complete. Created {create_count} dataset indexes. Skipped {skipped_count} datasets.", fg="green"
        )
    )


@click.command("add-qdrant-index", help="Add Qdrant index.")
@click.option("--field", default="metadata.doc_id", prompt=False, help="Index field , default is metadata.doc_id.")
def add_qdrant_index(field: str):
    click.echo(click.style("Starting Qdrant index creation.", fg="green"))

    create_count = 0

    try:
        bindings = db.session.scalars(select(DatasetCollectionBinding)).all()
        if not bindings:
            click.echo(click.style("No dataset collection bindings found.", fg="red"))
            return
        import qdrant_client
        from dify_vdb_qdrant.qdrant_vector import PathQdrantParams, QdrantConfig
        from qdrant_client.http.exceptions import UnexpectedResponse
        from qdrant_client.http.models import PayloadSchemaType

        for binding in bindings:
            if dify_config.QDRANT_URL is None:
                raise ValueError("Qdrant URL is required.")
            qdrant_config = QdrantConfig(
                endpoint=dify_config.QDRANT_URL,
                api_key=dify_config.QDRANT_API_KEY,
                root_path=current_app.root_path,
                timeout=dify_config.QDRANT_CLIENT_TIMEOUT,
                grpc_port=dify_config.QDRANT_GRPC_PORT,
                prefer_grpc=dify_config.QDRANT_GRPC_ENABLED,
            )
            try:
                params = qdrant_config.to_qdrant_params()
                # Check the type before using
                if isinstance(params, PathQdrantParams):
                    # PathQdrantParams case
                    client = qdrant_client.QdrantClient(path=params.path)
                else:
                    # UrlQdrantParams case - params is UrlQdrantParams
                    client = qdrant_client.QdrantClient(
                        url=params.url,
                        api_key=params.api_key,
                        timeout=int(params.timeout),
                        verify=params.verify,
                        grpc_port=params.grpc_port,
                        prefer_grpc=params.prefer_grpc,
                    )
                # create payload index
                client.create_payload_index(binding.collection_name, field, field_schema=PayloadSchemaType.KEYWORD)
                create_count += 1
            except UnexpectedResponse as e:
                # Collection does not exist, so return
                if e.status_code == 404:
                    click.echo(click.style(f"Collection not found: {binding.collection_name}.", fg="red"))
                    continue
                # Some other error occurred, so re-raise the exception
                else:
                    click.echo(
                        click.style(
                            f"Failed to create Qdrant index for collection: {binding.collection_name}.", fg="red"
                        )
                    )

    except Exception:
        click.echo(click.style("Failed to create Qdrant client.", fg="red"))

    click.echo(click.style(f"Index creation complete. Created {create_count} collection indexes.", fg="green"))


@click.command("old-metadata-migration", help="Old metadata migration.")
def old_metadata_migration():
    """
    Old metadata migration.
    """
    click.echo(click.style("Starting old metadata migration.", fg="green"))

    page = 1
    while True:
        try:
            stmt = (
                select(DatasetDocument)
                .where(DatasetDocument.doc_metadata.is_not(None))
                .order_by(DatasetDocument.created_at.desc())
            )
            documents = paginate_query(
                stmt, page=page, per_page=50, max_per_page=50, session=cast(Session, db.session())
            )
        except SQLAlchemyError:
            raise
        if not documents:
            break
        for document in documents:
            if document.doc_metadata:
                doc_metadata = document.doc_metadata
                for key in doc_metadata:
                    for field in BuiltInField:
                        if field.value == key:
                            break
                    else:
                        dataset_metadata = db.session.scalar(
                            select(DatasetMetadata)
                            .where(DatasetMetadata.dataset_id == document.dataset_id, DatasetMetadata.name == key)
                            .limit(1)
                        )
                        if not dataset_metadata:
                            dataset_metadata = DatasetMetadata(
                                tenant_id=document.tenant_id,
                                dataset_id=document.dataset_id,
                                name=key,
                                type=DatasetMetadataType.STRING,
                                created_by=document.created_by,
                            )
                            db.session.add(dataset_metadata)
                            db.session.flush()
                            dataset_metadata_binding: DatasetMetadataBinding | None = DatasetMetadataBinding(
                                tenant_id=document.tenant_id,
                                dataset_id=document.dataset_id,
                                metadata_id=dataset_metadata.id,
                                document_id=document.id,
                                created_by=document.created_by,
                            )
                            db.session.add(dataset_metadata_binding)
                        else:
                            dataset_metadata_binding = db.session.scalar(
                                select(DatasetMetadataBinding)
                                .where(
                                    DatasetMetadataBinding.dataset_id == document.dataset_id,
                                    DatasetMetadataBinding.document_id == document.id,
                                    DatasetMetadataBinding.metadata_id == dataset_metadata.id,
                                )
                                .limit(1)
                            )
                            if not dataset_metadata_binding:
                                dataset_metadata_binding = DatasetMetadataBinding(
                                    tenant_id=document.tenant_id,
                                    dataset_id=document.dataset_id,
                                    metadata_id=dataset_metadata.id,
                                    document_id=document.id,
                                    created_by=document.created_by,
                                )
                                db.session.add(dataset_metadata_binding)
                        db.session.commit()
        page += 1
    click.echo(click.style("Old metadata migration completed.", fg="green"))
