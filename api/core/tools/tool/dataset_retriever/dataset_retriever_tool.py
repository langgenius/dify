from pydantic import BaseModel, Field

from core.rag.datasource.retrieval_service import RetrievalService
from core.rag.models.document import Document as RetrievalDocument
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from core.tools.tool.dataset_retriever.dataset_retriever_base_tool import DatasetRetrieverBaseTool
from extensions.ext_database import db
from models.dataset import Dataset, Document, DocumentSegment
from services.external_knowledge_service import ExternalDatasetService

default_retrieval_model = {
    "search_method": RetrievalMethod.SEMANTIC_SEARCH.value,
    "reranking_enable": False,
    "reranking_model": {"reranking_provider_name": "", "reranking_model_name": ""},
    "reranking_mode": "reranking_model",
    "top_k": 2,
    "score_threshold_enabled": False,
}


class DatasetRetrieverToolInput(BaseModel):
    query: str = Field(..., description="Query for the dataset to be used to retrieve the dataset.")


class DatasetRetrieverTool(DatasetRetrieverBaseTool):
    """Tool for querying a Dataset."""

    name: str = "dataset"
    args_schema: type[BaseModel] = DatasetRetrieverToolInput
    description: str = "use this to retrieve a dataset. "
    dataset_id: str

    @classmethod
    def from_dataset(cls, dataset: Dataset, **kwargs):
        description = dataset.description
        if not description:
            description = "useful for when you want to answer queries about the " + dataset.name

        description = description.replace("\n", "").replace("\r", "")
        return cls(
            name=f"dataset_{dataset.id.replace('-', '_')}",
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            description=description,
            **kwargs,
        )

    def _run(self, query: str) -> str:
        dataset = (
            db.session.query(Dataset).filter(Dataset.tenant_id == self.tenant_id, Dataset.id == self.dataset_id).first()
        )

        if not dataset:
            return ""

        for hit_callback in self.hit_callbacks:
            hit_callback.on_query(query, dataset.id)
        if dataset.provider == "external":
            results = []
            external_documents = ExternalDatasetService.fetch_external_knowledge_retrieval(
                tenant_id=dataset.tenant_id,
                dataset_id=dataset.id,
                query=query,
                external_retrieval_parameters=dataset.retrieval_model,
            )
            for external_document in external_documents:
                document = RetrievalDocument(
                    page_content=external_document.get("content"),
                    metadata=external_document.get("metadata"),
                    provider="external",
                )
                document.metadata["score"] = external_document.get("score")
                document.metadata["title"] = external_document.get("title")
                document.metadata["dataset_id"] = dataset.id
                document.metadata["dataset_name"] = dataset.name
                results.append(document)
            # deal with external documents
            context_list = []
            for position, item in enumerate(results, start=1):
                source = {
                    "position": position,
                    "dataset_id": item.metadata.get("dataset_id"),
                    "dataset_name": item.metadata.get("dataset_name"),
                    "document_name": item.metadata.get("title"),
                    "data_source_type": "external",
                    "retriever_from": self.retriever_from,
                    "score": item.metadata.get("score"),
                    "title": item.metadata.get("title"),
                    "content": item.page_content,
                }
                context_list.append(source)
            for hit_callback in self.hit_callbacks:
                hit_callback.return_retriever_resource_info(context_list)

            return str("\n".join([item.page_content for item in results]))
        else:
            # get retrieval model , if the model is not setting , using default
            retrieval_model = dataset.retrieval_model or default_retrieval_model
            if dataset.indexing_technique == "economy":
                # use keyword table query
                documents = RetrievalService.retrieve(
                    retrieval_method="keyword_search", dataset_id=dataset.id, query=query, top_k=self.top_k
                )
                return str("\n".join([document.page_content for document in documents]))
            else:
                if self.top_k > 0:
                    # retrieval source
                    documents = RetrievalService.retrieve(
                        retrieval_method=retrieval_model.get("search_method", "semantic_search"),
                        dataset_id=dataset.id,
                        query=query,
                        top_k=self.top_k,
                        score_threshold=retrieval_model.get("score_threshold", 0.0)
                        if retrieval_model["score_threshold_enabled"]
                        else 0.0,
                        reranking_model=retrieval_model.get("reranking_model", None)
                        if retrieval_model["reranking_enable"]
                        else None,
                        reranking_mode=retrieval_model.get("reranking_mode") or "reranking_model",
                        weights=retrieval_model.get("weights", None),
                    )
                else:
                    documents = []

                for hit_callback in self.hit_callbacks:
                    hit_callback.on_tool_end(documents)
                document_score_list = {}
                if dataset.indexing_technique != "economy":
                    for item in documents:
                        if item.metadata.get("score"):
                            document_score_list[item.metadata["doc_id"]] = item.metadata["score"]
                document_context_list = []
                index_node_ids = [document.metadata["doc_id"] for document in documents]
                segments = DocumentSegment.query.filter(
                    DocumentSegment.dataset_id == self.dataset_id,
                    DocumentSegment.completed_at.isnot(None),
                    DocumentSegment.status == "completed",
                    DocumentSegment.enabled == True,
                    DocumentSegment.index_node_id.in_(index_node_ids),
                ).all()

                if segments:
                    index_node_id_to_position = {id: position for position, id in enumerate(index_node_ids)}
                    sorted_segments = sorted(
                        segments, key=lambda segment: index_node_id_to_position.get(segment.index_node_id, float("inf"))
                    )
                    for segment in sorted_segments:
                        if segment.answer:
                            document_context_list.append(
                                f"question:{segment.get_sign_content()} answer:{segment.answer}"
                            )
                        else:
                            document_context_list.append(segment.get_sign_content())
                    if self.return_resource:
                        context_list = []
                        resource_number = 1
                        for segment in sorted_segments:
                            context = {}
                            document = Document.query.filter(
                                Document.id == segment.document_id,
                                Document.enabled == True,
                                Document.archived == False,
                            ).first()
                            if dataset and document:
                                source = {
                                    "position": resource_number,
                                    "dataset_id": dataset.id,
                                    "dataset_name": dataset.name,
                                    "document_id": document.id,
                                    "document_name": document.name,
                                    "data_source_type": document.data_source_type,
                                    "segment_id": segment.id,
                                    "retriever_from": self.retriever_from,
                                    "score": document_score_list.get(segment.index_node_id, None),
                                }
                                if self.retriever_from == "dev":
                                    source["hit_count"] = segment.hit_count
                                    source["word_count"] = segment.word_count
                                    source["segment_position"] = segment.position
                                    source["index_node_hash"] = segment.index_node_hash
                                if segment.answer:
                                    source["content"] = f"question:{segment.content} \nanswer:{segment.answer}"
                                else:
                                    source["content"] = segment.content
                                context_list.append(source)
                            resource_number += 1

                        for hit_callback in self.hit_callbacks:
                            hit_callback.return_retriever_resource_info(context_list)

                return str("\n".join(document_context_list))
