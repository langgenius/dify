from typing import Optional

from core.rag.datasource.keyword.keyword_factory import Keyword
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.models.document import Document
from models.dataset import Dataset, DocumentSegment


class VectorService:

    @classmethod
    def create_segments_vector(cls, keywords_list: Optional[list[list[str]]],
                               segments: list[DocumentSegment], dataset: Dataset):
        documents = []
        for segment in segments:
            document = Document(
                page_content=segment.content,
                metadata={
                    "doc_id": segment.index_node_id,
                    "doc_hash": segment.index_node_hash,
                    "document_id": segment.document_id,
                    "dataset_id": segment.dataset_id,
                }
            )
            documents.append(document)
        if dataset.indexing_technique == 'high_quality':
            # save vector index
            vector = Vector(
                dataset=dataset
            )
            vector.add_texts(documents, duplicate_check=True)

        # save keyword index
        keyword = Keyword(dataset)

        if keywords_list and len(keywords_list) > 0:
            keyword.add_texts(documents, keyword_list=keywords_list)
        else:
            keyword.add_texts(documents)

    @classmethod
    def update_segment_vector(cls, keywords: Optional[list[str]], segment: DocumentSegment, dataset: Dataset):
        # update segment index task

        # format new index
        document = Document(
            page_content=segment.content,
            metadata={
                "doc_id": segment.index_node_id,
                "doc_hash": segment.index_node_hash,
                "document_id": segment.document_id,
                "dataset_id": segment.dataset_id,
            }
        )
        if dataset.indexing_technique == 'high_quality':
            # update vector index
            vector = Vector(
                dataset=dataset
            )
            vector.delete_by_ids([segment.index_node_id])
            vector.add_texts([document], duplicate_check=True)

        # update keyword index
        keyword = Keyword(dataset)
        keyword.delete_by_ids([segment.index_node_id])

        # save keyword index
        if keywords and len(keywords) > 0:
            keyword.add_texts([document], keywords_list=[keywords])
        else:
            keyword.add_texts([document])
