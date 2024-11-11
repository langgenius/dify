from flask_restful import Resource, inputs, marshal, marshal_with, reqparse

from controllers.common import fields
from controllers.common import helpers as controller_helpers
from controllers.service_api import api
from controllers.service_api.app.error import AppUnavailableError
from controllers.service_api.wraps import validate_app_token
from fields.app_fields import (
    app_pagination_fields,
)
from models.model import App, AppMode
from services.app_service import AppService


class AppParameterApi(Resource):
    """Resource for app variables."""

    @validate_app_token
    @marshal_with(fields.parameters_fields)
    def get(self, app_model: App):
        """Retrieve app parameters."""
        if app_model.mode in {AppMode.ADVANCED_CHAT.value, AppMode.WORKFLOW.value}:
            workflow = app_model.workflow
            if workflow is None:
                raise AppUnavailableError()

            features_dict = workflow.features_dict
            user_input_form = workflow.user_input_form(to_old_structure=True)
        else:
            app_model_config = app_model.app_model_config
            if app_model_config is None:
                raise AppUnavailableError()

            features_dict = app_model_config.to_dict()

            user_input_form = features_dict.get("user_input_form", [])

        return controller_helpers.get_parameters_from_feature_dict(
            features_dict=features_dict, user_input_form=user_input_form
        )


class AppMetaApi(Resource):
    @validate_app_token
    def get(self, app_model: App):
        """Get app meta"""
        return AppService().get_app_meta(app_model)


class AppInfoApi(Resource):
    @validate_app_token
    def get(self, app_model: App):
        """Get app information"""
        return {"name": app_model.name, "description": app_model.description}


class AppsListApi(Resource):
    @validate_app_token
    def get(self, tenant_id: str, modes):
        """Get apps list"""
        parser = reqparse.RequestParser()
        parser.add_argument("page", type=inputs.int_range(1, 99999), required=False, default=1, location="args")
        parser.add_argument("limit", type=inputs.int_range(1, 100), required=False, default=100, location="args")
        parser.add_argument(
            "mode",
            type=str,
            choices=modes,
            default="all",
            location="args",
            required=False,
        )

        args = parser.parse_args()

        app_service = AppService()
        app_pagination = app_service.get_paginate_apps(tenant_id, args)
        if not app_pagination:
            return {"data": [], "total": 0, "page": 1, "limit": 20, "has_more": False}

        return marshal(app_pagination, app_pagination_fields)


api.add_resource(AppParameterApi, "/parameters")
api.add_resource(AppMetaApi, "/meta")
api.add_resource(AppInfoApi, "/info")
api.add_resource(AppsListApi, "/list")
