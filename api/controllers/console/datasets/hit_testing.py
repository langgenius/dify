import logging

from flask_login import current_user
from libs.login import login_required
from flask_restful import Resource, reqparse, marshal
from werkzeug.exceptions import InternalServerError, NotFound, Forbidden

import services
from controllers.console import api
from controllers.console.app.error import ProviderNotInitializeError, ProviderQuotaExceededError, \
    ProviderModelCurrentlyNotSupportError
from controllers.console.datasets.error import HighQualityDatasetOnlyError, DatasetNotInitializedError
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from core.model_providers.error import ProviderTokenNotInitError, QuotaExceededError, ModelCurrentlyNotSupportError, \
    LLMBadRequestError
from fields.hit_testing_fields import hit_testing_record_fields
from services.dataset_service import DatasetService
from services.hit_testing_service import HitTestingService


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
        except LLMBadRequestError:
            raise ProviderNotInitializeError(
                f"No Embedding Model available. Please configure a valid provider "
                f"in the Settings -> Model Provider.")
        except ValueError as e:
            raise ValueError(str(e))
        except Exception as e:
            logging.exception("Hit testing failed.")
            raise InternalServerError(str(e))


api.add_resource(HitTestingApi, '/datasets/<uuid:dataset_id>/hit-testing')
