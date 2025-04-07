from typing import Any

from pydantic import BaseModel, Field

from core.rag.datasource.retrieval_service import RetrievalService
from core.rag.entities.context_entities import DocumentContext
from core.rag.models.document import Document as RetrievalDocument
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from core.tools.utils.dataset_retriever.dataset_retriever_base_tool import DatasetRetrieverBaseTool
from extensions.ext_database import db
from models.dataset import Dataset
from models.dataset import Document as DatasetDocument
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
                if document.metadata is not None:
                    document.metadata["score"] = external_document.get("score")
                    document.metadata["title"] = external_document.get("title")
                    document.metadata["dataset_id"] = dataset.id
                    document.metadata["dataset_name"] = dataset.name
                    results.append(document)
            # deal with external documents
            context_list = []
            for position, item in enumerate(results, start=1):
                if item.metadata is not None:
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
            retrieval_model: dict[str, Any] = dataset.retrieval_model or default_retrieval_model
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
                        reranking_model=retrieval_model.get("reranking_model")
                        if retrieval_model["reranking_enable"]
                        else None,
                        reranking_mode=retrieval_model.get("reranking_mode") or "reranking_model",
                        weights=retrieval_model.get("weights"),
                    )
                else:
                    documents = []
                for hit_callback in self.hit_callbacks:
                    hit_callback.on_tool_end(documents)
                document_score_list = {}
                if dataset.indexing_technique != "economy":
                    for item in documents:
                        if item.metadata is not None and item.metadata.get("score"):
                            document_score_list[item.metadata["doc_id"]] = item.metadata["score"]
                document_context_list = []
                records = RetrievalService.format_retrieval_documents(documents)
                if records:
                    for record in records:
                        segment = record.segment
                        if segment.answer:
                            document_context_list.append(
                                DocumentContext(
                                    content=f"question:{segment.get_sign_content()} answer:{segment.answer}",
                                    score=record.score,
                                )
                            )
                        else:
                            document_context_list.append(
                                DocumentContext(
                                    content=segment.get_sign_content(),
                                    score=record.score,
                                )
                            )
                    retrieval_resource_list = []
                    if self.return_resource:
                        for record in records:
                            segment = record.segment
                            dataset = Dataset.query.filter_by(id=segment.dataset_id).first()
                            document = DatasetDocument.query.filter(
                                DatasetDocument.id == segment.document_id,
                                DatasetDocument.enabled == True,
                                DatasetDocument.archived == False,
                            ).first()
                            if dataset and document:
                                source = {
                                    "dataset_id": dataset.id,
                                    "dataset_name": dataset.name,
                                    "document_id": document.id,  # type: ignore
                                    "document_name": document.name,  # type: ignore
                                    "data_source_type": document.data_source_type,  # type: ignore
                                    "segment_id": segment.id,
                                    "retriever_from": self.retriever_from,
                                    "score": record.score or 0.0,
                                    "doc_metadata": document.doc_metadata,  # type: ignore
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
                                retrieval_resource_list.append(source)

            if self.return_resource and retrieval_resource_list:
                retrieval_resource_list = sorted(
                    retrieval_resource_list,
                    key=lambda x: x.get("score") or 0.0,
                    reverse=True,
                )
                for position, item in enumerate(retrieval_resource_list, start=1):  # type: ignore
                    item["position"] = position  # type: ignore
                for hit_callback in self.hit_callbacks:
                    hit_callback.return_retriever_resource_info(retrieval_resource_list)
            if document_context_list:
                document_context_list = sorted(document_context_list, key=lambda x: x.score or 0.0, reverse=True)
                return str("\n".join([document_context.content for document_context in document_context_list]))
            return ""
