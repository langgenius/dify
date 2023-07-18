import logging

from flask_login import login_required, current_user
from flask_restful import Resource, reqparse, marshal, fields
from werkzeug.exceptions import InternalServerError, NotFound, Forbidden

import services
from controllers.console import api
from controllers.console.app.error import ProviderNotInitializeError, ProviderQuotaExceededError, \
    ProviderModelCurrentlyNotSupportError
from controllers.console.datasets.error import HighQualityDatasetOnlyError, DatasetNotInitializedError
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from core.llm.error import ProviderTokenNotInitError, QuotaExceededError, ModelCurrentlyNotSupportError
from libs.helper import TimestampField
from services.dataset_service import DatasetService
from services.hit_testing_service import HitTestingService

document_fields = {
    'id': fields.String,
    'data_source_type': fields.String,
    'name': fields.String,
    'doc_type': fields.String,
}

segment_fields = {
    'id': fields.String,
    'position': fields.Integer,
    'document_id': fields.String,
    'content': fields.String,
    'word_count': fields.Integer,
    'tokens': fields.Integer,
    'keywords': fields.List(fields.String),
    'index_node_id': fields.String,
    'index_node_hash': fields.String,
    'hit_count': fields.Integer,
    'enabled': fields.Boolean,
    'disabled_at': TimestampField,
    'disabled_by': fields.String,
    'status': fields.String,
    'created_by': fields.String,
    'created_at': TimestampField,
    'indexing_at': TimestampField,
    'completed_at': TimestampField,
    'error': fields.String,
    'stopped_at': TimestampField,
    'document': fields.Nested(document_fields),
}

hit_testing_record_fields = {
    'segment': fields.Nested(segment_fields),
    'score': fields.Float,
    'tsne_position': fields.Raw
}


class HitTestingApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def post(self, dataset_id):
        dataset_id_str = str(dataset_id)

        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")

        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        # only high quality dataset can be used for hit testing
        if dataset.indexing_technique != 'high_quality':
            raise HighQualityDatasetOnlyError()

        parser = reqparse.RequestParser()
        parser.add_argument('query', type=str, location='json')
        args = parser.parse_args()

        query = args['query']

        if not query or len(query) > 250:
            raise ValueError('Query is required and cannot exceed 250 characters')

        try:
            response = HitTestingService.retrieve(
                dataset=dataset,
                query=query,
                account=current_user,
                limit=10,
            )

            return {"query": response['query'], 'records': marshal(response['records'], hit_testing_record_fields)}
        except services.errors.index.IndexNotInitializedError:
            raise DatasetNotInitializedError()
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        except QuotaExceededError:
            raise ProviderQuotaExceededError()
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError()
        except Exception as e:
            logging.exception("Hit testing failed.")
            raise InternalServerError(str(e))


api.add_resource(HitTestingApi, '/datasets/<uuid:dataset_id>/hit-testing')
