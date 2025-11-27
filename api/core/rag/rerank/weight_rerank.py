import math
from collections import Counter, defaultdict
from typing import DefaultDict

from core.rag.datasource.keyword.jieba.jieba_keyword_table_handler import JiebaKeywordTableHandler
from core.rag.models.document import Document
from core.rag.rerank.entity.weight import Weights
from core.rag.rerank.rerank_base import BaseRerankRunner


class WeightRerankRunner(BaseRerankRunner):
    def __init__(self, tenant_id: str, weights: Weights):
        self.tenant_id = tenant_id
        self.weights = weights

    def run(
        self,
        query: str,
        documents: list[Document],
        score_threshold: float | None = None,
        top_n: int | None = None,
        user: str | None = None,
    ) -> list[Document]:
        """
        Run rerank model
        :param query: search query
        :param documents: documents for reranking
        :param score_threshold: score threshold
        :param top_n: top n
        :param user: unique user id if needed

        :return:
        """

        query_scores = self._calculate_keyword_score(query, documents)
        query_vector_scores = self._get_documents_score(documents)

        score_map: DefaultDict[str, float] = defaultdict(float)
        for document, q_score, q_vector_score in zip(documents, query_scores, query_vector_scores):
            if document.provider == "dify" and document.metadata is not None and "doc_id" in document.metadata:
                doc_id = document.metadata["doc_id"]
                score_map[doc_id] += self.weights.keyword_setting.keyword_weight * q_score
                score_map[doc_id] += self.weights.vector_setting.vector_weight * q_vector_score
        uniq_ids = set()
        rerank_documents = []
        for document in documents:
            if document.provider == "dify" and document.metadata is not None and "doc_id" in document.metadata:
                doc_id = document.metadata["doc_id"]
                score = score_map[doc_id]
                if score_threshold and score < score_threshold:
                    continue
                if doc_id not in uniq_ids:
                    uniq_ids.add(doc_id)
                    document.metadata["score"] = score
                    rerank_documents.append(document)
            else:
                # for other provider documents, keep the original score
                rerank_documents.append(document)

        rerank_documents.sort(key=lambda x: x.metadata["score"] if x.metadata else 0, reverse=True)
        return rerank_documents[:top_n] if top_n else rerank_documents

    def _calculate_keyword_score(self, query: str, documents: list[Document]) -> list[float]:
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
            if document.metadata is not None:
                document.metadata["keywords"] = document_keywords
                documents_keywords.append(document_keywords)

        # Counter query keywords(TF)
        query_keyword_counts = Counter(query_keywords)

        # total documents
        total_documents = len(documents)

        # calculate all documents' keywords IDF
        all_keywords = set()
        for document_keywords in documents_keywords:
            all_keywords.update(document_keywords)

        keyword_idf = {}
        for keyword in all_keywords:
            # calculate include query keywords' documents
            doc_count_containing_keyword = sum(1 for doc_keywords in documents_keywords if keyword in doc_keywords)
            # IDF
            keyword_idf[keyword] = math.log((1 + total_documents) / (1 + doc_count_containing_keyword)) + 1

        query_tfidf = {}

        for keyword, count in query_keyword_counts.items():
            tf = count
            idf = keyword_idf.get(keyword, 0)
            query_tfidf[keyword] = tf * idf

        # calculate all documents' TF-IDF
        documents_tfidf = []
        for document_keywords in documents_keywords:
            document_keyword_counts = Counter(document_keywords)
            document_tfidf = {}
            for keyword, count in document_keyword_counts.items():
                tf = count
                idf = keyword_idf.get(keyword, 0)
                document_tfidf[keyword] = tf * idf
            documents_tfidf.append(document_tfidf)

        def cosine_similarity(vec1, vec2):
            intersection = set(vec1.keys()) & set(vec2.keys())
            numerator = sum(vec1[x] * vec2[x] for x in intersection)

            sum1 = sum(vec1[x] ** 2 for x in vec1)
            sum2 = sum(vec2[x] ** 2 for x in vec2)
            denominator = math.sqrt(sum1) * math.sqrt(sum2)

            if not denominator:
                return 0.0
            else:
                return float(numerator) / denominator

        similarities = []
        for document_tfidf in documents_tfidf:
            similarity = cosine_similarity(query_tfidf, document_tfidf)
            similarities.append(similarity)

        # for idx, similarity in enumerate(similarities):
        #     print(f"Document {idx + 1} similarity: {similarity}")

        return similarities

    def _get_documents_score(self, documents: list[Document]) -> list[float]:
        """
        Extracts scores from the metadata of each document.
        :param documents: documents for reranking

        :return: A list of scores, with 0.0 for documents without a score.
        """
        query_vector_scores = []
        for document in documents:
            # calculate cosine similarity
            if document.metadata and "score" in document.metadata:
                query_vector_scores.append(document.metadata["score"])
            else:
                query_vector_scores.append(0)
        return query_vector_scores
