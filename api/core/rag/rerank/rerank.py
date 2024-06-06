import os
from typing import Optional

from flashrank import Ranker, RerankRequest
from flask import current_app
from rank_bm25 import BM25Okapi

from core.model_manager import ModelInstance
from core.rag.datasource.keyword.jieba.jieba_keyword_table_handler import JiebaKeywordTableHandler
from core.rag.models.document import Document


class RerankRunner:
    def __init__(self, rerank_model_instance: ModelInstance) -> None:
        self.rerank_model_instance = rerank_model_instance

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
        passages = []
        i = 1
        for document in documents:
            passage = {
                'id': i,
                'text': document.page_content
            }
            passages.append(passage)
            i += 1
        folder = current_app.config.get('STORAGE_LOCAL_PATH')
        if not os.path.isabs(folder):
            folder = os.path.join(current_app.root_path, folder)
        ranker = Ranker(model_name="rank-T5-flan", cache_dir=folder)
        rerank_request = RerankRequest(query=query, passages=passages)
        results = ranker.rerank(rerank_request)
        print(results)
        document_BM25 = []
        for document in documents:
            document_BM25.append(document.page_content)

        # 预处理：分词
        keyword_table_handler = JiebaKeywordTableHandler()

        tokenized_documents = [keyword_table_handler.extract_keywords(doc, 20) for doc in document_BM25]

        tokenized_query = keyword_table_handler.extract_keywords(query, 20)

        # 创建BM25对象
        bm25 = BM25Okapi(tokenized_documents)

        # 计算查询与每个文档的BM25分数
        doc_scores = bm25.get_scores(tokenized_query)

        # 输出BM25分数
        for i, score in enumerate(doc_scores):
            print(f"Document {i + 1}: BM25 Score = {score}")

        rerank_result = self.rerank_model_instance.invoke_rerank(
            query=query,
            docs=docs,
            score_threshold=score_threshold,
            top_n=top_n,
            user=user
        )

        rerank_documents = []

        for result in rerank_result.docs:
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
