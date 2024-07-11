from typing import Optional

import numpy as np

from core.embedding.cached_embedding import CacheEmbedding
from core.model_manager import ModelManager
from core.model_runtime.entities.model_entities import ModelType
from core.rag.datasource.keyword.jieba.jieba_keyword_table_handler import JiebaKeywordTableHandler
from core.rag.models.document import Document
from core.rag.rerank.entity.weight import Weights, VectorSetting
from rank_bm25 import BM25Okapi
from sklearn.feature_extraction.text import TfidfVectorizer


class WeightRerankRunner:

    def __init__(self, tenant_id: str, weights: Weights) -> None:
        self.tenant_id = tenant_id
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

        query_vector_scores = self._calculate_cosine(self.tenant_id, query, documents, self.weights.vector_setting)
        for document, query_bm25_score, query_vector_score in zip(documents, query_bm25_scores, query_vector_scores):
            # format document
            score = self.weights.vector_setting.vector_weight * query_vector_score + \
                    self.weights.keyword_setting.keyword_weight * query_bm25_score
            if score_threshold and score < score_threshold:
                continue
            document.metadata['score'] = score
            rerank_documents.append(document)
        rerank_documents = sorted(rerank_documents, key=lambda x: x.metadata['score'], reverse=True)
        return rerank_documents[:top_n] if top_n else rerank_documents

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
            documents_keywords.append(document_keywords)
        # build bm25 model
        bm25 = BM25Okapi(documents_keywords)
        query_bm25_scores = bm25.get_scores(query_keywords)

        # normalize BM25 scores to the range [0, 1]
        max_score = max(query_bm25_scores)
        min_score = min(query_bm25_scores)

        normalized_query_bm25_scores = [(score - min_score) / (max_score - min_score) if max_score != min_score else 0 for score in
                             query_bm25_scores]

        # 初始化TfidfVectorizer
        vectorizer = TfidfVectorizer()

        # 拟合文档并转换文档关键词
        tfidf_matrix = vectorizer.fit_transform(documents_keywords)

        # 将查询转换为TF-IDF向量
        query_tfidf = vectorizer.transform([query])

        # 获取词汇表
        feature_names = vectorizer.get_feature_names_out()

        # 打印查询的TF-IDF值
        query_tfidf_values = query_tfidf.toarray()[0]
        for word, tfidf_value in zip(feature_names, query_tfidf_values):
            if tfidf_value > 0:
                print(f"Query word: {word}, TF-IDF value: {tfidf_value:.4f}")

        return normalized_query_bm25_scores

    def _calculate_cosine(self, tenant_id: str, query: str, documents: list[Document],
                          vector_setting: VectorSetting) -> list[float]:
        """
        Calculate Cosine scores
        :param query: search query
        :param documents: documents for reranking

        :return:
        """
        query_vector_scores = []

        model_manager = ModelManager()

        embedding_model = model_manager.get_model_instance(
            tenant_id=tenant_id,
            provider=vector_setting.embedding_provider_name,
            model_type=ModelType.TEXT_EMBEDDING,
            model=vector_setting.embedding_model_name

        )
        cache_embedding = CacheEmbedding(embedding_model)
        query_vector = cache_embedding.embed_query(query)
        for document in documents:
            # calculate cosine similarity
            if 'score' in document.metadata:
                query_vector_scores.append(document.metadata['score'])
            else:
                content_vector = document.metadata['vector']
                # transform to NumPy
                vec1 = np.array(query_vector)
                vec2 = np.array(document.metadata['vector'])

                # calculate dot product
                dot_product = np.dot(vec1, vec2)

                # calculate norm
                norm_vec1 = np.linalg.norm(vec1)
                norm_vec2 = np.linalg.norm(vec2)

                # calculate cosine similarity
                cosine_sim = dot_product / (norm_vec1 * norm_vec2)
                query_vector_scores.append(cosine_sim)

        return query_vector_scores
