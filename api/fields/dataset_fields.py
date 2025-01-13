from flask_restful import fields  # type: ignore

from libs.helper import TimestampField

dataset_fields = {
    "id": fields.String,
    "name": fields.String,
    "description": fields.String,
    "permission": fields.String,
    "data_source_type": fields.String,
    "indexing_technique": fields.String,
    "created_by": fields.String,
    "created_at": TimestampField,
}

reranking_model_fields = {"reranking_provider_name": fields.String, "reranking_model_name": fields.String}

keyword_setting_fields = {"keyword_weight": fields.Float}

vector_setting_fields = {
    "vector_weight": fields.Float,
    "embedding_model_name": fields.String,
    "embedding_provider_name": fields.String,
}

weighted_score_fields = {
    "keyword_setting": fields.Nested(keyword_setting_fields),
    "vector_setting": fields.Nested(vector_setting_fields),
}

dataset_retrieval_model_fields = {
    "search_method": fields.String,
    "reranking_enable": fields.Boolean,
    "reranking_mode": fields.String,
    "reranking_model": fields.Nested(reranking_model_fields),
    "weights": fields.Nested(weighted_score_fields, allow_null=True),
    "top_k": fields.Integer,
    "score_threshold_enabled": fields.Boolean,
    "score_threshold": fields.Float,
}
external_retrieval_model_fields = {
    "top_k": fields.Integer,
    "score_threshold": fields.Float,
    "score_threshold_enabled": fields.Boolean,
}

tag_fields = {"id": fields.String, "name": fields.String, "type": fields.String}

external_knowledge_info_fields = {
    "external_knowledge_id": fields.String,
    "external_knowledge_api_id": fields.String,
    "external_knowledge_api_name": fields.String,
    "external_knowledge_api_endpoint": fields.String,
}

dataset_detail_fields = {
    "id": fields.String,
    "name": fields.String,
    "description": fields.String,
    "provider": fields.String,
    "permission": fields.String,
    "data_source_type": fields.String,
    "indexing_technique": fields.String,
    "app_count": fields.Integer,
    "document_count": fields.Integer,
    "word_count": fields.Integer,
    "created_by": fields.String,
    "created_at": TimestampField,
    "updated_by": fields.String,
    "updated_at": TimestampField,
    "embedding_model": fields.String,
    "embedding_model_provider": fields.String,
    "embedding_available": fields.Boolean,
    "retrieval_model_dict": fields.Nested(dataset_retrieval_model_fields),
    "tags": fields.List(fields.Nested(tag_fields)),
    "doc_form": fields.String,
    "external_knowledge_info": fields.Nested(external_knowledge_info_fields),
    "external_retrieval_model": fields.Nested(external_retrieval_model_fields, allow_null=True),
}

dataset_query_detail_fields = {
    "id": fields.String,
    "content": fields.String,
    "source": fields.String,
    "source_app_id": fields.String,
    "created_by_role": fields.String,
    "created_by": fields.String,
    "created_at": TimestampField,
}
