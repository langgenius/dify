import json
from collections.abc import Generator
from typing import Any, cast

from flask import request
from flask_restx import Resource, fields, marshal_with
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from controllers.common.schema import get_or_create_model, register_schema_model
from core.datasource.entities.datasource_entities import DatasourceProviderType, OnlineDocumentPagesMessage
from core.datasource.online_document.online_document_plugin import OnlineDocumentDatasourcePlugin
from core.indexing_runner import IndexingRunner
from core.rag.extractor.entity.datasource_type import DatasourceType
from core.rag.extractor.entity.extract_setting import ExtractSetting, NotionInfo
from core.rag.extractor.notion_extractor import NotionExtractor
from extensions.ext_database import db
from fields.data_source_fields import (
    integrate_fields,
    integrate_icon_fields,
    integrate_list_fields,
    integrate_notion_info_list_fields,
    integrate_page_fields,
    integrate_workspace_fields,
)
from libs.datetime_utils import naive_utc_now
from libs.login import current_account_with_tenant, login_required
from models import DataSourceOauthBinding, Document
from services.dataset_service import DatasetService, DocumentService
from services.datasource_provider_service import DatasourceProviderService
from tasks.document_indexing_sync_task import document_indexing_sync_task

from .. import console_ns
from ..wraps import account_initialization_required, setup_required


class NotionEstimatePayload(BaseModel):
    notion_info_list: list[dict[str, Any]]
    process_rule: dict[str, Any]
    doc_form: str = Field(default="text_model")
    doc_language: str = Field(default="English")


class DataSourceNotionListQuery(BaseModel):
    dataset_id: str | None = Field(default=None, description="Dataset ID")
    credential_id: str = Field(..., description="Credential ID", min_length=1)
    datasource_parameters: dict[str, Any] | None = Field(default=None, description="Datasource parameters JSON string")


class DataSourceNotionPreviewQuery(BaseModel):
    credential_id: str = Field(..., description="Credential ID", min_length=1)


register_schema_model(console_ns, NotionEstimatePayload)


integrate_icon_model = get_or_create_model("DataSourceIntegrateIcon", integrate_icon_fields)

integrate_page_fields_copy = integrate_page_fields.copy()
integrate_page_fields_copy["page_icon"] = fields.Nested(integrate_icon_model, allow_null=True)
integrate_page_model = get_or_create_model("DataSourceIntegratePage", integrate_page_fields_copy)

integrate_workspace_fields_copy = integrate_workspace_fields.copy()
integrate_workspace_fields_copy["pages"] = fields.List(fields.Nested(integrate_page_model))
integrate_workspace_model = get_or_create_model("DataSourceIntegrateWorkspace", integrate_workspace_fields_copy)

integrate_fields_copy = integrate_fields.copy()
integrate_fields_copy["source_info"] = fields.Nested(integrate_workspace_model)
integrate_model = get_or_create_model("DataSourceIntegrate", integrate_fields_copy)

integrate_list_fields_copy = integrate_list_fields.copy()
integrate_list_fields_copy["data"] = fields.List(fields.Nested(integrate_model))
integrate_list_model = get_or_create_model("DataSourceIntegrateList", integrate_list_fields_copy)

notion_page_fields = {
    "page_name": fields.String,
    "page_id": fields.String,
    "page_icon": fields.Nested(integrate_icon_model, allow_null=True),
    "is_bound": fields.Boolean,
    "parent_id": fields.String,
    "type": fields.String,
}
notion_page_model = get_or_create_model("NotionIntegratePage", notion_page_fields)

notion_workspace_fields = {
    "workspace_name": fields.String,
    "workspace_id": fields.String,
    "workspace_icon": fields.String,
    "pages": fields.List(fields.Nested(notion_page_model)),
}
notion_workspace_model = get_or_create_model("NotionIntegrateWorkspace", notion_workspace_fields)

integrate_notion_info_list_fields_copy = integrate_notion_info_list_fields.copy()
integrate_notion_info_list_fields_copy["notion_info"] = fields.List(fields.Nested(notion_workspace_model))
integrate_notion_info_list_model = get_or_create_model(
    "NotionIntegrateInfoList", integrate_notion_info_list_fields_copy
)


@console_ns.route(
    "/data-source/integrates",
    "/data-source/integrates/<uuid:binding_id>/<string:action>",
)
class DataSourceApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(integrate_list_model)
    def get(self):
        _, current_tenant_id = current_account_with_tenant()

        # get workspace data source integrates
        data_source_integrates = db.session.scalars(
            select(DataSourceOauthBinding).where(
                DataSourceOauthBinding.tenant_id == current_tenant_id,
                DataSourceOauthBinding.disabled == False,
            )
        ).all()

        base_url = request.url_root.rstrip("/")
        data_source_oauth_base_path = "/console/api/oauth/data-source"
        providers = ["notion"]

        integrate_data = []
        for provider in providers:
            # existing_integrate = next((ai for ai in data_source_integrates if ai.provider == provider), None)
            existing_integrates = filter(lambda item: item.provider == provider, data_source_integrates)
            if existing_integrates:
                for existing_integrate in list(existing_integrates):
                    integrate_data.append(
                        {
                            "id": existing_integrate.id,
                            "provider": provider,
                            "created_at": existing_integrate.created_at,
                            "is_bound": True,
                            "disabled": existing_integrate.disabled,
                            "source_info": existing_integrate.source_info,
                            "link": f"{base_url}{data_source_oauth_base_path}/{provider}",
                        }
                    )
            else:
                integrate_data.append(
                    {
                        "id": None,
                        "provider": provider,
                        "created_at": None,
                        "source_info": None,
                        "is_bound": False,
                        "disabled": None,
                        "link": f"{base_url}{data_source_oauth_base_path}/{provider}",
                    }
                )
        return {"data": integrate_data}, 200

    @setup_required
    @login_required
    @account_initialization_required
    def patch(self, binding_id, action):
        binding_id = str(binding_id)
        action = str(action)
        with Session(db.engine) as session:
            data_source_binding = session.execute(
                select(DataSourceOauthBinding).filter_by(id=binding_id)
            ).scalar_one_or_none()
        if data_source_binding is None:
            raise NotFound("Data source binding not found.")
        # enable binding
        if action == "enable":
            if data_source_binding.disabled:
                data_source_binding.disabled = False
                data_source_binding.updated_at = naive_utc_now()
                db.session.add(data_source_binding)
                db.session.commit()
            else:
                raise ValueError("Data source is not disabled.")
        # disable binding
        if action == "disable":
            if not data_source_binding.disabled:
                data_source_binding.disabled = True
                data_source_binding.updated_at = naive_utc_now()
                db.session.add(data_source_binding)
                db.session.commit()
            else:
                raise ValueError("Data source is disabled.")
        return {"result": "success"}, 200


@console_ns.route("/notion/pre-import/pages")
class DataSourceNotionListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(integrate_notion_info_list_model)
    def get(self):
        current_user, current_tenant_id = current_account_with_tenant()

        query = DataSourceNotionListQuery.model_validate(request.args.to_dict())

        # Get datasource_parameters from query string (optional, for GitHub and other datasources)
        datasource_parameters = query.datasource_parameters or {}

        datasource_provider_service = DatasourceProviderService()
        credential = datasource_provider_service.get_datasource_credentials(
            tenant_id=current_tenant_id,
            credential_id=query.credential_id,
            provider="notion_datasource",
            plugin_id="langgenius/notion_datasource",
        )
        if not credential:
            raise NotFound("Credential not found.")
        exist_page_ids = []
        with Session(db.engine) as session:
            # import notion in the exist dataset
            if query.dataset_id:
                dataset = DatasetService.get_dataset(query.dataset_id)
                if not dataset:
                    raise NotFound("Dataset not found.")
                if dataset.data_source_type != "notion_import":
                    raise ValueError("Dataset is not notion type.")

                documents = session.scalars(
                    select(Document).filter_by(
                        dataset_id=query.dataset_id,
                        tenant_id=current_tenant_id,
                        data_source_type="notion_import",
                        enabled=True,
                    )
                ).all()
                if documents:
                    for document in documents:
                        data_source_info = json.loads(document.data_source_info)
                        exist_page_ids.append(data_source_info["notion_page_id"])
            # get all authorized pages
            from core.datasource.datasource_manager import DatasourceManager

            datasource_runtime = DatasourceManager.get_datasource_runtime(
                provider_id="langgenius/notion_datasource/notion_datasource",
                datasource_name="notion_datasource",
                tenant_id=current_tenant_id,
                datasource_type=DatasourceProviderType.ONLINE_DOCUMENT,
            )
            datasource_provider_service = DatasourceProviderService()
            if credential:
                datasource_runtime.runtime.credentials = credential
            datasource_runtime = cast(OnlineDocumentDatasourcePlugin, datasource_runtime)
            online_document_result: Generator[OnlineDocumentPagesMessage, None, None] = (
                datasource_runtime.get_online_document_pages(
                    user_id=current_user.id,
                    datasource_parameters=datasource_parameters,
                    provider_type=datasource_runtime.datasource_provider_type(),
                )
            )
            try:
                pages = []
                workspace_info = {}
                for message in online_document_result:
                    result = message.result
                    for info in result:
                        workspace_info = {
                            "workspace_id": info.workspace_id,
                            "workspace_name": info.workspace_name,
                            "workspace_icon": info.workspace_icon,
                        }
                        for page in info.pages:
                            page_info = {
                                "page_id": page.page_id,
                                "page_name": page.page_name,
                                "type": page.type,
                                "parent_id": page.parent_id,
                                "is_bound": page.page_id in exist_page_ids,
                                "page_icon": page.page_icon,
                            }
                            pages.append(page_info)
            except Exception as e:
                raise e
            return {"notion_info": {**workspace_info, "pages": pages}}, 200


@console_ns.route(
    "/notion/pages/<uuid:page_id>/<string:page_type>/preview",
    "/datasets/notion-indexing-estimate",
)
class DataSourceNotionApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, page_id, page_type):
        _, current_tenant_id = current_account_with_tenant()

        query = DataSourceNotionPreviewQuery.model_validate(request.args.to_dict())

        datasource_provider_service = DatasourceProviderService()
        credential = datasource_provider_service.get_datasource_credentials(
            tenant_id=current_tenant_id,
            credential_id=query.credential_id,
            provider="notion_datasource",
            plugin_id="langgenius/notion_datasource",
        )

        page_id = str(page_id)

        extractor = NotionExtractor(
            notion_workspace_id="",
            notion_obj_id=page_id,
            notion_page_type=page_type,
            notion_access_token=credential.get("integration_secret"),
            tenant_id=current_tenant_id,
        )

        text_docs = extractor.extract()
        return {"content": "\n".join([doc.page_content for doc in text_docs])}, 200

    @setup_required
    @login_required
    @account_initialization_required
    @console_ns.expect(console_ns.models[NotionEstimatePayload.__name__])
    def post(self):
        _, current_tenant_id = current_account_with_tenant()

        payload = NotionEstimatePayload.model_validate(console_ns.payload or {})
        args = payload.model_dump()
        # validate args
        DocumentService.estimate_args_validate(args)
        notion_info_list = payload.notion_info_list
        extract_settings = []
        for notion_info in notion_info_list:
            workspace_id = notion_info["workspace_id"]
            credential_id = notion_info.get("credential_id")
            for page in notion_info["pages"]:
                extract_setting = ExtractSetting(
                    datasource_type=DatasourceType.NOTION,
                    notion_info=NotionInfo.model_validate(
                        {
                            "credential_id": credential_id,
                            "notion_workspace_id": workspace_id,
                            "notion_obj_id": page["page_id"],
                            "notion_page_type": page["type"],
                            "tenant_id": current_tenant_id,
                        }
                    ),
                    document_model=args["doc_form"],
                )
                extract_settings.append(extract_setting)
        indexing_runner = IndexingRunner()
        response = indexing_runner.indexing_estimate(
            current_tenant_id,
            extract_settings,
            args["process_rule"],
            args["doc_form"],
            args["doc_language"],
        )
        return response.model_dump(), 200


@console_ns.route("/datasets/<uuid:dataset_id>/notion/sync")
class DataSourceNotionDatasetSyncApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id):
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")

        documents = DocumentService.get_document_by_dataset_id(dataset_id_str)
        for document in documents:
            document_indexing_sync_task.delay(dataset_id_str, document.id)
        return {"result": "success"}, 200


@console_ns.route("/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/notion/sync")
class DataSourceNotionDocumentSyncApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id, document_id):
        dataset_id_str = str(dataset_id)
        document_id_str = str(document_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")

        document = DocumentService.get_document(dataset_id_str, document_id_str)
        if document is None:
            raise NotFound("Document not found.")
        document_indexing_sync_task.delay(dataset_id_str, document_id_str)
        return {"result": "success"}, 200
