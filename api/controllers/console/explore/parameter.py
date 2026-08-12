from typing import Any, cast

from pydantic import BaseModel, Field

from controllers.common import fields
from controllers.common.schema import register_response_schema_models
from controllers.console import console_ns
from controllers.console.app.error import AppUnavailableError
from controllers.console.explore.wraps import InstalledAppResource
from core.app.app_config.common.parameters_mapping import get_parameters_from_feature_dict
from extensions.ext_database import db
from models.model import AppMode, InstalledApp, load_annotation_reply_config
from services.app_service import AppService


class ExploreAppMetaResponse(BaseModel):
    """Metadata consumed by the installed-app chat UI.

    Built-in tool icons are URL strings; API-based tool icons are provider-defined payload objects.
    """

    tool_icons: dict[str, str | dict[str, Any]] = Field(default_factory=dict)


register_response_schema_models(console_ns, fields.Parameters, ExploreAppMetaResponse)


@console_ns.route("/installed-apps/<uuid:installed_app_id>/parameters", endpoint="installed_app_parameters")
class AppParameterApi(InstalledAppResource):
    """Resource for app variables."""

    @console_ns.response(200, "Success", console_ns.models[fields.Parameters.__name__])
    def get(self, installed_app: InstalledApp):
        """Retrieve app parameters."""
        session = db.session()
        app_model = installed_app.app_with_session(session=session)

        if app_model is None:
            raise AppUnavailableError()

        if app_model.mode in {AppMode.ADVANCED_CHAT, AppMode.WORKFLOW}:
            workflow = app_model.workflow_with_session(session=session)
            if workflow is None:
                raise AppUnavailableError()

            features_dict: dict[str, Any] = workflow.features_dict
            user_input_form = workflow.user_input_form(to_old_structure=True)
        else:
            app_model_config = app_model.app_model_config_with_session(session=session)
            if app_model_config is None:
                raise AppUnavailableError()

            annotation_reply = load_annotation_reply_config(session, app_model.id)
            features_dict = cast(
                dict[str, Any],
                app_model_config.to_dict(annotation_reply=annotation_reply),
            )

            user_input_form = features_dict.get("user_input_form", [])

        parameters = get_parameters_from_feature_dict(features_dict=features_dict, user_input_form=user_input_form)
        return fields.Parameters.model_validate(parameters).model_dump(mode="json")


@console_ns.route("/installed-apps/<uuid:installed_app_id>/meta", endpoint="installed_app_meta")
class ExploreAppMetaApi(InstalledAppResource):
    @console_ns.response(200, "Success", console_ns.models[ExploreAppMetaResponse.__name__])
    def get(self, installed_app: InstalledApp):
        """Get app meta"""
        app_model = installed_app.app_with_session(session=db.session())
        if not app_model:
            raise ValueError("App not found")
        return AppService().get_app_meta(app_model, session=db.session())
