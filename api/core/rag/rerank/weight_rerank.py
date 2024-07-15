import math
from collections import Counter
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
        # # build bm25 model
        # bm25 = BM25Okapi(documents_keywords)
        # query_bm25_scores = bm25.get_scores(query_keywords)
        #
        # # normalize BM25 scores to the range [0, 1]
        # max_score = max(query_bm25_scores)
        # min_score = min(query_bm25_scores)
        #
        # normalized_query_bm25_scores = [(score - min_score) / (max_score - min_score) if max_score != min_score else 0 for score in
        #                      query_bm25_scores]

        # 计算查询关键词的词频(TF)
        query_keyword_counts = Counter(query_keywords)

        # 总文档数
        total_documents = len(documents)

        # 计算所有文档中的关键词IDF
        all_keywords = set()
        for document_keywords in documents_keywords:
            all_keywords.update(document_keywords)

        keyword_idf = {}
        for keyword in all_keywords:
            # 统计包含该关键词的文档数
            doc_count_containing_keyword = sum(1 for doc_keywords in documents_keywords if keyword in doc_keywords)
            # 计算IDF值
            keyword_idf[keyword] = math.log((1 + total_documents) / (1 + doc_count_containing_keyword)) + 1

        # 计算查询的TF-IDF值
        query_tfidf = {}

        for keyword, count in query_keyword_counts.items():
            tf = count
            idf = keyword_idf.get(keyword, 0)
            query_tfidf[keyword] = tf * idf

        # 计算每个文档的TF-IDF值
        documents_tfidf = []
        for document_keywords in documents_keywords:
            document_keyword_counts = Counter(document_keywords)
            s = 1e-9
            q = 1e-9
            for k, v in query_keyword_counts.items():
                if k in document_keyword_counts:
                    s += v  # * dtwt[k]
            for k, v in query_keyword_counts.items():
                q += v  # * v
            # d = 1e-9
            # for k, v in dtwt.items():
            #    d += v * v
            score = s / q / max(1, math.sqrt(
                math.log10(max(len(query_keyword_counts.keys()), len(document_keyword_counts.keys())))))
            print(f"ragflow similarity: {score}")
            document_tfidf = {}
            for keyword, count in document_keyword_counts.items():
                tf = count
                idf = keyword_idf.get(keyword, 0)
                document_tfidf[keyword] = tf * idf
            documents_tfidf.append(document_tfidf)

        # 计算查询TF-IDF值与每个文档TF-IDF值的相似度
        def cosine_similarity(vec1, vec2):
            intersection = set(vec1.keys()) & set(vec2.keys())
            numerator = sum([vec1[x] * vec2[x] for x in intersection])

            sum1 = sum([vec1[x] ** 2 for x in vec1.keys()])
            sum2 = sum([vec2[x] ** 2 for x in vec2.keys()])
            denominator = math.sqrt(sum1) * math.sqrt(sum2)

            if not denominator:
                return 0.0
            else:
                return float(numerator) / denominator

        # 计算相似度
        similarities = []
        for document_tfidf in documents_tfidf:
            similarity = cosine_similarity(query_tfidf, document_tfidf)
            similarities.append(similarity)

        # 打印每个文档的相似度
        for idx, similarity in enumerate(similarities):
            print(f"Document {idx + 1} similarity: {similarity}")

        return similarities

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
