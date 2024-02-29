from flask_restful import fields

from libs.helper import TimestampField

dataset_fields = {
    'id': fields.String,
    'name': fields.String,
    'description': fields.String,
    'permission': fields.String,
    'data_source_type': fields.String,
    'indexing_technique': fields.String,
    'created_by': fields.String,
    'created_at': TimestampField,
}

reranking_model_fields = {
    'reranking_provider_name': fields.String,
    'reranking_model_name': fields.String
}

dataset_retrieval_model_fields = {
    'search_method': fields.String,
    'reranking_enable': fields.Boolean,
    'reranking_model': fields.Nested(reranking_model_fields),
    'top_k': fields.Integer,
    'score_threshold_enabled': fields.Boolean,
    'score_threshold': fields.Float
}


dataset_detail_fields = {
    'id': fields.String,
    'name': fields.String,
    'description': fields.String,
    'provider': fields.String,
    'permission': fields.String,
    'data_source_type': fields.String,
    'indexing_technique': fields.String,
    'app_count': fields.Integer,
    'document_count': fields.Integer,
    'word_count': fields.Integer,
    'created_by': fields.String,
    'created_at': TimestampField,
    'updated_by': fields.String,
    'updated_at': TimestampField,
    'embedding_model': fields.String,
    'embedding_model_provider': fields.String,
    'embedding_available': fields.Boolean,
    'retrieval_model_dict': fields.Nested(dataset_retrieval_model_fields)
}

dataset_query_detail_fields = {
    "id": fields.String,
    "content": fields.String,
    "source": fields.String,
    "source_app_id": fields.String,
    "created_by_role": fields.String,
    "created_by": fields.String,
    "created_at": TimestampField
}


