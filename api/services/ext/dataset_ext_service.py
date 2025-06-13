from models import ApiToken, Account, Tenant
from models.dataset import (
    Dataset,DocumentSegment,Document
)
from core.rag.models.document import Document as DocumentModel
from core.errors.error import (
    LLMBadRequestError,
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from controllers.console.app.error import (
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from extensions.ext_database import db
from services.dataset_service import DatasetService, DocumentService
from configs.ext_config import get_init_knowledge_config,get_init_full_text_knowledge_config
from services.entities.knowledge_entities.knowledge_entities import KnowledgeConfig
from sqlalchemy import text, bindparam,select,func
from collections import defaultdict
from sqlalchemy.dialects.postgresql import ARRAY

class DatasetExtService:
    resource_type = "dataset"
    token_prefix = "dataset-"
    max_keys = 10
    @staticmethod
    def get_datasets(tenant_id=None, target_tenant_id=None) -> list[Dataset]:
        datasets = (Dataset.query
                 .filter(Dataset.tenant_id == tenant_id,Dataset.target_tenant_id == target_tenant_id)
                 .all())
        return datasets

    @staticmethod
    def get_datasets_config(dataset_id=None,tenant_id=None, default_config:dict=None) -> dict:
        # 取默认的值
        dataset_ids = [dataset_id]
        datasets, total = DatasetService.get_datasets_by_ids(ids=dataset_ids, tenant_id=tenant_id)
        args = {}
        if total > 0:
            dataset_dict=datasets[0].__dict__
            if 'FULL_TEXT' in dataset_dict["name"]:
                args = get_init_full_text_knowledge_config({})
            else:
                args = get_init_knowledge_config({})
            keys_to_override = ['indexing_technique', 'process_rule', 'doc_form'
                ,'doc_language','retrieval_model','embedding_model','embedding_model_provider']

            args.update({k: dataset_dict[k] for k in keys_to_override if k in dataset_dict and dataset_dict[k] is not None})

        if default_config is not None:
            args={**args,**default_config}

        # validate args
        return args

    @staticmethod
    def init_dataset(tenant:Tenant=None, target_tenant_id:str=None,target_tenant_name:str=None, account:Account=None) -> list[Dataset]:

        # 判断是否有知识库，如果没有，创建知识库
        datasets = (DatasetExtService.get_datasets(tenant_id=tenant.id, target_tenant_id=target_tenant_id))

        if not datasets:
            public_name = f"PUBLIC_KNOWLEDGE"
            public_description = f"{target_tenant_name}的公共知识库"
            public_dataset = DatasetService.create_empty_dataset(tenant_id=tenant.id,
                                                          name=public_name,
                                                          description=public_description,
                                                          indexing_technique="",
                                                          account=account)
            public_dataset.target_tenant_id = target_tenant_id

            company_name = f"COMPANY_KNOWLEDGE"
            company_description = f"{target_tenant_name}的企业知识库"

            company_dataset = DatasetService.create_empty_dataset(tenant_id=tenant.id,
                                                          name=company_name,
                                                          description=company_description,
                                                          indexing_technique="",
                                                          account=account)
            company_dataset.target_tenant_id = target_tenant_id
            db.session.commit()
            datasets = [public_dataset,company_dataset]

        return datasets


    @staticmethod
    def set_dataset_config(dataset=None,current_user=None):

        # 取默认的值
        args = get_init_knowledge_config({})
        # validate args
        knowledge_config = KnowledgeConfig(**args)
        print("knowledge_config")
        try:
            DocumentService.save_document_with_dataset_id(dataset, knowledge_config, current_user)
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        except QuotaExceededError:
            raise ProviderQuotaExceededError()
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError()

    # @staticmethod
    def get_or_add_datasets_api_token(self,tenant_id: str):
        api_tokens = (
            db.session.query(ApiToken)
            .filter(ApiToken.type == self.resource_type, ApiToken.tenant_id == tenant_id)
            .all()
        )
        if not api_tokens:
            key = ApiToken.generate_api_key(self.token_prefix, 24)
            api_token = ApiToken()
            api_token.tenant_id = tenant_id
            api_token.token = key
            api_token.type = self.resource_type
            db.session.add(api_token)
            db.session.commit()
            return api_token
        else:
            return api_tokens[-1]



class DocumentExtService:

    # 为文档
    @staticmethod
    def set_next_segments(all_documents: list[DocumentModel]) :

        # 判断文档是否为空
        if all_documents:
            document_ids = []
            doc_segment_ids = []
            for document in all_documents:
                if document.children is None:
                    doc_segment_id = document.metadata["doc_id"]
                    document_id = document.metadata["document_id"]
                    doc_segment_ids.append(doc_segment_id)
                    document_ids.append(document_id)

            # 找到文档的所有的
            if len(document_ids) > 0:
                document_segments = db.session.query(DocumentSegment).filter(DocumentSegment.document_id.in_(document_ids)).all()
                document_segment_data = {}
                for document_segment in document_segments:
                    key = document_segment.document_id
                    if key not in document_segment_data:
                        document_segment_data[key] = []
                    document_segment_data[key].append(document_segment)
                DocumentExtService.merged_next_segment_content(all_documents=all_documents,document_segment_data=document_segment_data,doc_segment_ids=doc_segment_ids)

    # 为文档
    @staticmethod
    def merged_next_segment_content(all_documents: list[DocumentModel],document_segment_data: dict,doc_segment_ids: list) :
        # 判断文档是否为空
        if all_documents:
            for document in all_documents:
                if document.children is None:
                    doc_segment_id = document.metadata["doc_id"]
                    document_id = document.metadata["document_id"]
                    document_segments = document_segment_data[document_id]
                    next_segment = DocumentExtService.get_next_segment(doc_segment_id=doc_segment_id,document_segments=document_segments)
                    if next_segment and next_segment.index_node_id not in doc_segment_ids:
                        unin_content = DocumentExtService.merged_text(document.page_content, next_segment.content)
                        doc_segment_ids.append(next_segment.index_node_id)
                        document.page_content = unin_content

    @staticmethod
    def merged_text(text, target_text) -> str:
        # 初始化最大重叠长度为0
        max_overlap_length = 0  # 初始化变量max_overlap_length用于存储最大重叠长度

        # 检查A的结尾与B的开头是否有大于10个字符的重叠
        for overlap_length in range(1, min(len(text), len(target_text)) + 1):  # 遍历可能的重叠长度从1到最小字符串长度
            if text[-overlap_length:] == target_text[:overlap_length]:  # 检查A的后缀和B的前缀是否相同
                max_overlap_length = overlap_length  # 更新最大重叠长度

        # 如果有大于10个字符的重叠，则合并字符串
        if max_overlap_length > 10:  # 判断最大重叠长度是否大于10
            merged_string = text + target_text[max_overlap_length:]  # 合并字符串，去掉重复部分
        else:
            merged_string = text

        return merged_string

    @staticmethod
    def get_next_segment(doc_segment_id, document_segments: list[DocumentSegment]) -> DocumentSegment:
        next_segment = None
        if document_segments is not None and len(document_segments) > 0:
            this_positions = -1
            for index, document_segment in enumerate(document_segments):
                if document_segment.index_node_id == doc_segment_id:
                    this_positions = document_segment.position
            for document_segment in document_segments:
                if document_segment.position == this_positions + 1:
                    next_segment = document_segment
                    break
        return next_segment


    def get_full_search_data(dataset_names: list[str], tenant_id : str, query_text: str):

        datasets = db.session.query(Dataset).filter(Dataset.name.in_(dataset_names),Dataset.tenant_id == tenant_id).all()
        dataset_ids = [dataset.id for dataset in datasets]
        # 精准查询的向量片段
        fetch_segments = DocumentExtService.get_full_search_segments(dataset_ids=dataset_ids,query_text=query_text)

        search_datas = []
        for segment in fetch_segments:
            search_data = {
                "title": segment.document_name,
                "content": segment.segment_content,
                "query": query_text
            }
            search_datas.append(search_data)

        return search_datas

    def get_full_search_segments(dataset_ids: list[str], query_text: str):

        sql = text("""
            SELECT s.id segment_id, s.document_id, s.content segment_content, d.name document_name
            FROM document_segments s
                left join documents d on d.id = s.document_id
            WHERE content ILIKE :keyword and d.dataset_id::text = ANY(:dataset_ids)
        """)
        # import uuid
        # dataset_ids_uuid = [uuid.UUID(id_str) for id_str in dataset_ids]
        segments_rows = db.session.execute(sql, {"keyword": f"%{query_text}%", "dataset_ids" : dataset_ids}).fetchall()

        sql = text("""
            SELECT d.id AS document_id,
                   d.name AS document_name,
                   s.id AS segment_id,
                   s.content AS segment_content
            FROM documents d
            JOIN (
                SELECT s1.*
                FROM document_segments s1
                INNER JOIN (
                    SELECT document_id, MIN(position) AS first_position
                    FROM document_segments
                    GROUP BY document_id
                ) s2 ON s1.document_id = s2.document_id AND s1.position = s2.first_position
            ) s ON d.id = s.document_id
            WHERE d.name ILIKE :keyword and d.dataset_id::text = ANY(:dataset_ids_)
        """)

        document_rows = db.session.execute(sql, {"keyword": f"%{query_text}%", "dataset_ids_" : dataset_ids}).fetchall()

        grouped = defaultdict(list)

        for row in document_rows:
            grouped[row.document_id].append(row)

        for row in segments_rows:
            grouped[row.document_id].append(row)

        fetch_segments = []
        # 遍历 grouped
        for document_id, segment_list in grouped.items():
            # document_name = segment_list[0].document_name
            if len(segment_list) == 1:
                fetch_segments.append(segment_list[0])
            else:
                fetch_segments.append(segment_list[1])
        return fetch_segments
