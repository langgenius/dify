
from typing import Optional

from langchain.schema import Document

from core.index.index import IndexBuilder
from models.dataset import Dataset, DocumentSegment


class VectorService:

    @classmethod
    def create_segment_vector(cls, keywords: Optional[list[str]], segment: DocumentSegment, dataset: Dataset):
        document = Document(
            page_content=segment.content,
            metadata={
                "doc_id": segment.index_node_id,
                "doc_hash": segment.index_node_hash,
                "document_id": segment.document_id,
                "dataset_id": segment.dataset_id,
            }
        )

        # save vector index
        index = IndexBuilder.get_index(dataset, 'high_quality')
        if index:
            index.add_texts([document], duplicate_check=True)

        # save keyword index
        index = IndexBuilder.get_index(dataset, 'economy')
        if index:
            if keywords and len(keywords) > 0:
                index.create_segment_keywords(segment.index_node_id, keywords)
            else:
                index.add_texts([document])

    @classmethod
    def multi_create_segment_vector(cls, pre_segment_data_list: list, dataset: Dataset):
        documents = []
        for pre_segment_data in pre_segment_data_list:
            segment = pre_segment_data['segment']
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

        # save vector index
        index = IndexBuilder.get_index(dataset, 'high_quality')
        if index:
            index.add_texts(documents, duplicate_check=True)

        # save keyword index
        keyword_index = IndexBuilder.get_index(dataset, 'economy')
        if keyword_index:
            keyword_index.multi_create_segment_keywords(pre_segment_data_list)

    @classmethod
    def update_segment_vector(cls, keywords: Optional[list[str]], segment: DocumentSegment, dataset: Dataset):
        # update segment index task
        vector_index = IndexBuilder.get_index(dataset, 'high_quality')
        kw_index = IndexBuilder.get_index(dataset, 'economy')
        # delete from vector index
        if vector_index:
            vector_index.delete_by_ids([segment.index_node_id])

        # delete from keyword index
        kw_index.delete_by_ids([segment.index_node_id])

        # add new index
        document = Document(
            page_content=segment.content,
            metadata={
                "doc_id": segment.index_node_id,
                "doc_hash": segment.index_node_hash,
                "document_id": segment.document_id,
                "dataset_id": segment.dataset_id,
            }
        )

        # save vector index
        if vector_index:
            vector_index.add_texts([document], duplicate_check=True)

        # save keyword index
        if keywords and len(keywords) > 0:
            kw_index.create_segment_keywords(segment.index_node_id, keywords)
        else:
            kw_index.add_texts([document])
