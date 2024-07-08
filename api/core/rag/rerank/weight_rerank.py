from typing import Optional

from numba import np

from core.rag.datasource.keyword.jieba.jieba_keyword_table_handler import JiebaKeywordTableHandler
from core.rag.models.document import Document
from core.rag.rerank.entity.weight import Weights
from rank_bm25 import BM25Okapi


class WeightRerankRunner:

    def __init__(self, weights: Weights) -> None:
        self.weights = weights

    def run(self, query: str, documents: list[Document], score_threshold: Optional[float] = None,
            top_n: Optional[int] = None, user: Optional[str] = None) -> list[Document]:
        """
        Run rerank model
        :param query: search query
        :param documents: documents for reranking
        :param score_threshold: score threshold
        :param top_n: top n
        :param user: unique user id if needed

        :return:
        """
        docs = []
        doc_id = []
        unique_documents = []
        for document in documents:
            if document.metadata['doc_id'] not in doc_id:
                doc_id.append(document.metadata['doc_id'])
                docs.append(document.page_content)
                unique_documents.append(document)

        documents = unique_documents

        rerank_documents = []
        query_bm25_scores = self._calculate_bm25(query, documents)

        query_vector_scores = self._calculate_cosine(query, documents)
        for document in documents:
            # format document
            rerank_document = Document(
                page_content=result.text,
                metadata={
                    "doc_id": documents[result.index].metadata['doc_id'],
                    "doc_hash": documents[result.index].metadata['doc_hash'],
                    "document_id": documents[result.index].metadata['document_id'],
                    "dataset_id": documents[result.index].metadata['dataset_id'],
                    'score': result.score
                }
            )
            rerank_documents.append(rerank_document)

        return rerank_documents

    def _calculate_bm25(self, query: str, documents: list[Document]) -> list[float]:
        """
        Calculate BM25 scores
        :param query: search query
        :param documents: documents for reranking

        :return:
        """
        keyword_table_handler = JiebaKeywordTableHandler()
        query_keywords = keyword_table_handler.extract_keywords(query, None)
        documents_keywords = []
        for document in documents:
            # get the document keywords
            document_keywords = keyword_table_handler.extract_keywords(document.page_content, None)
            document.metadata['keywords'] = document_keywords
            documents_keywords.append(document)
        # build bm25 model
        bm25 = BM25Okapi(documents_keywords)
        query_bm25_scores = bm25.get_scores(query_keywords)

        return query_bm25_scores

    def _calculate_cosine(self, query: str, documents: list[Document]) -> list[float]:
        """
        Calculate Cosine scores
        :param query: search query
        :param documents: documents for reranking

        :return:
        """
        query_vector_scores = []
        query_vector =
        for document in documents:
            # calculate cosine similarity
            if 'score' in document.metadata:
                query_vector_scores.append(document.metadata['score'])
            else:
                vector = document.metadata['vector']
                # transform to NumPy
                vec1 = np.array(vec1)
                vec2 = np.array(vec2)

                # calculate dot product
                dot_product = np.dot(vec1, vec2)

                # calculate norm
                norm_vec1 = np.linalg.norm(vec1)
                norm_vec2 = np.linalg.norm(vec2)

                # calculate cosine similarity
                cosine_sim = dot_product / (norm_vec1 * norm_vec2)
                query_vector_scores.append(cosine_sim)

         return query_vector_scores
