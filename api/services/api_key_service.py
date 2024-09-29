from flask_login import current_user
from flask_restful import Resource, fields, marshal_with
from werkzeug.exceptions import Forbidden

from extensions.ext_database import db
from libs.helper import TimestampField
from libs.login import login_required
from models.dataset import Dataset
from models.model import ApiToken, App
from models.model import ResourceType
from constants.model_template import default_resource_type
from models.account import Account
from werkzeug.exceptions import  NotFound
from libs.exception import BaseHTTPException


class AppKeyService:
    max_keys = 10
    def newApiKey(self,account:Account,resource_id:str,resource_type:str,resource_id_field:str,token_prefix:str)-> ApiToken:
        resource_id = str(resource_id)
        resource_model = default_resource_type[ResourceType.value_of(resource_type)]
        _get_resource(resource_id, account.current_tenant_id, resource_model)

        current_key_count = (
            db.session.query(ApiToken)
            .filter(ApiToken.type == resource_type, getattr(ApiToken, resource_id_field) == resource_id)
            .count()
        )

        if current_key_count >= self.max_keys:
            raise ApiKeyExceedsLimit()

        key = ApiToken.generate_api_key(token_prefix, 24)
        api_token = ApiToken()
        setattr(api_token, resource_id_field, resource_id)
        api_token.tenant_id = account.current_tenant_id
        api_token.token = key
        api_token.type = resource_type
        db.session.add(api_token)
        db.session.commit()
        return api_token

def _get_resource(resource_id, tenant_id, resource_model):
    resource = resource_model.query.filter_by(id=resource_id, tenant_id=tenant_id).first()
    if resource is None:
        raise NotFound(f"{resource_model.__name__} not found.")
    return resource

class ApiKeyExceedsLimit(BaseHTTPException):
    error_code = "api key exceeds limit"
    description = "api key exceeds limit."
    code = 200