import logging

from flask_login import current_user
from flask_restful import marshal, reqparse
from werkzeug.exceptions import Forbidden, InternalServerError, NotFound

import services.dataset_service
from controllers.console.app.error import (
    CompletionRequestError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.console.datasets.error import DatasetNotInitializedError
from controllers.service_api import api
from controllers.service_api.wraps import DatasetApiResource
from core.errors.error import (
    LLMBadRequestError,
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from core.model_runtime.errors.invoke import InvokeError
from fields.hit_testing_fields import hit_testing_record_fields
from services.dataset_service import DatasetService
from services.hit_testing_service import HitTestingService


class HitTestingApi(DatasetApiResource):
    def post(self, tenant_id, dataset_id):
        dataset_id_str = str(dataset_id)
        logging.error(f"{dataset_id_str}")

        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")

        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        parser = reqparse.RequestParser()

        parser.add_argument("query", type=str, location="json")
        parser.add_argument("retrieval_model", type=dict, required=False, location="json")
        parser.add_argument("external_retrieval_model", type=dict, required=False, location="json")
        args = parser.parse_args()

        HitTestingService.hit_testing_args_check(args)

        try:
            response = HitTestingService.retrieve(
                dataset=dataset,
                query=args["query"],
                account=current_user,
                retrieval_model=args["retrieval_model"],
                external_retrieval_model=args["external_retrieval_model"],
                limit=10,
            )

            return {"query": response["query"], "records": marshal(response["records"], hit_testing_record_fields)}
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
                "No Embedding Model or Reranking Model available. Please configure a valid provider "
                "in the Settings -> Model Provider."
            )
        except InvokeError as e:
            raise CompletionRequestError(e.description)
        except ValueError as e:
            raise ValueError(str(e))
        except Exception as e:
            logging.exception("Hit testing failed.")
            raise InternalServerError(str(e))


api.add_resource(HitTestingApi, "/datasets2/<uuid:dataset_id>/hit-testing")
