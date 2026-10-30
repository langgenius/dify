import math
from collections import Counter
from dataclasses import dataclass
from typing import override

import numpy as np

from core.credit_usage import CreditUsageCreatedBy
from core.model_context import with_credit_usage_created_by
from core.model_manager import ModelManager
from core.rag.datasource.keyword.jieba.jieba_keyword_table_handler import JiebaKeywordTableHandler
from core.rag.embedding.cached_embedding import CacheEmbedding
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.index_processor.constant.query_type import QueryType
from core.rag.models.document import Document
from core.rag.rerank.entity.weight import (
    VectorSetting,
    WeightedScoreObservation,
    WeightedScoreStage,
    Weights,
    build_weighted_score_observation,
    report_weighted_score_observation,
)
from core.rag.rerank.rerank_base import BaseRerankRunner
from graphon.model_runtime.entities.model_entities import ModelType


class WeightRerankRunner(BaseRerankRunner):
    def __init__(self, tenant_id: str, weights: Weights):
        self.tenant_id = tenant_id
        self.weights = weights

    @override
    def run(
        self,
        query: str,
        documents: list[Document],
        score_threshold: float | None = None,
        top_n: int | None = None,
        query_type: QueryType = QueryType.TEXT_QUERY,
    ) -> list[Document]:
        """
        Run rerank model
        :param query: search query
        :param documents: documents for reranking
        :param score_threshold: score threshold
        :param top_n: top n

        :return:
        """
        unique_documents = []
        doc_ids = set()
        for document in documents:
            if (
                document.provider == "dify"
                and document.metadata is not None
                and document.metadata["doc_id"] not in doc_ids
            ):
                # weight rerank only support text documents
                if not document.metadata.get("doc_type") or document.metadata.get("doc_type") == DocType.TEXT:
                    doc_ids.add(document.metadata["doc_id"])
                    unique_documents.append(document)
            else:
                if document not in unique_documents:
                    unique_documents.append(document)

        documents = unique_documents

        query_scores = self._calculate_keyword_score(query, documents)
        query_vector_scores = self._calculate_cosine(self.tenant_id, query, documents, self.weights.vector_setting)

        scored = [
            _ScoredCandidate(
                document=document,
                vector_score=query_vector_score,
                keyword_score=query_score,
                final_score=self.weights.vector_setting.vector_weight * query_vector_score
                + self.weights.keyword_setting.keyword_weight * query_score,
            )
            for document, query_score, query_vector_score in zip(
                documents, query_scores, query_vector_scores, strict=False
            )
        ]

        rerank_documents = []
        for candidate in scored:
            passes_threshold = not (score_threshold and candidate.final_score < score_threshold)
            if passes_threshold and candidate.document.metadata is not None:
                candidate.document.metadata["score"] = candidate.final_score
                rerank_documents.append(candidate.document)

        rerank_documents.sort(key=lambda x: x.metadata["score"] if x.metadata else 0, reverse=True)
        result = rerank_documents[:top_n] if top_n else rerank_documents
        if query_type == QueryType.TEXT_QUERY:
            report_weighted_score_observation(
                lambda stage: self._build_observation(
                    stage=stage, scored=scored, result=result, score_threshold=score_threshold, top_n=top_n
                )
            )
        return result

    def _build_observation(
        self,
        *,
        stage: WeightedScoreStage,
        scored: list["_ScoredCandidate"],
        result: list[Document],
        score_threshold: float | None,
        top_n: int | None,
    ) -> WeightedScoreObservation:
        """Describe every scored candidate, marking the ones returned in ``result`` with their rank."""
        ranks = {id(document): rank for rank, document in enumerate(result)}
        return build_weighted_score_observation(
            stage=stage,
            weights=self.weights,
            score_threshold=score_threshold,
            top_n=top_n,
            candidate_metadata=[candidate.document.metadata for candidate in scored],
            vector_scores=[candidate.vector_score for candidate in scored],
            keyword_scores=[candidate.keyword_score for candidate in scored],
            final_scores=[candidate.final_score for candidate in scored],
            selected_ranks=[ranks.get(id(candidate.document)) for candidate in scored],
        )

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

    @with_credit_usage_created_by(CreditUsageCreatedBy.KNOWLEDGE_RETRIEVAL)
    def _calculate_cosine(
        self, tenant_id: str, query: str, documents: list[Document], vector_setting: VectorSetting
    ) -> list[float]:
        """
        Calculate cosine scores, resolving the query vector only for unscored documents.
        :param query: search query
        :param documents: documents for reranking

        :return:
        """
        query_vector_scores = []
        query_vector: list[float] | None = None
        for document in documents:
            # calculate cosine similarity
            if document.metadata and "score" in document.metadata:
                query_vector_scores.append(document.metadata["score"])
            else:
                if query_vector is None:
                    query_vector = CacheEmbedding.get_cached_query_embedding(
                        vector_setting.embedding_provider_name, vector_setting.embedding_model_name, query
                    )
                    if query_vector is None:
                        model_manager = ModelManager.for_tenant(tenant_id=tenant_id)
                        embedding_model = model_manager.get_model_instance(
                            tenant_id=tenant_id,
                            provider=vector_setting.embedding_provider_name,
                            model_type=ModelType.TEXT_EMBEDDING,
                            model=vector_setting.embedding_model_name,
                        )
                        query_vector = CacheEmbedding(embedding_model).embed_query(query)

                # transform to NumPy
                vec1 = np.array(query_vector)
                vec2 = np.array(document.vector)

                # calculate dot product
                dot_product = np.dot(vec1, vec2)

                # calculate norm
                norm_vec1 = np.linalg.norm(vec1)
                norm_vec2 = np.linalg.norm(vec2)

                # calculate cosine similarity
                cosine_sim = dot_product / (norm_vec1 * norm_vec2)
                query_vector_scores.append(cosine_sim)

        return query_vector_scores


@dataclass(frozen=True, slots=True)
class _ScoredCandidate:
    document: Document
    vector_score: float
    keyword_score: float
    final_score: float
