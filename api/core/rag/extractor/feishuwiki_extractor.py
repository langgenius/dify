import json
from typing import Optional

from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.models.document import Document
from extensions.ext_database import db
from libs.oauth_data_source import FeishuWiki
from models.dataset import Document as DocumentModel
from models.source import DataSourceOauthBinding


class FeishuWikiExtractor(BaseExtractor):
    def __init__(
        self,
        feishu_workspace_id: str,
        obj_token: str,
        obj_type: str,
        tenant_id: str,
        document_model: Optional[DocumentModel] = None,
    ):
        self._tenant_id = tenant_id
        self._feishu_workspace_id = feishu_workspace_id
        self._document_model = document_model
        self._feishu_obj_token = obj_token
        self._feishu_obj_type = obj_type

    def feishuwiki(self) -> FeishuWiki:
        app_info, app_secret = self._get_app_info(self._tenant_id, self._feishu_workspace_id)
        return FeishuWiki(app_info, app_secret)

    def extract(self) -> list[Document]:
        self.update_last_edited_time(self._document_model)
        if self._feishu_obj_type == "docx":
            md_content = self.feishuwiki().get_document_markdown_content(self._feishu_obj_token)
            return [Document(page_content=md_content)]
        else:
            raise ValueError("feishu obj type not supported")

    def update_last_edited_time(self, document_model: DocumentModel):
        if not document_model:
            return
        last_edited_time = self.feishuwiki().get_feishu_wiki_node_last_edited_time(
            self._feishu_obj_token, self._feishu_obj_type
        )

        data_source_info = document_model.data_source_info_dict
        data_source_info["last_edited_time"] = last_edited_time
        update_params = {DocumentModel.data_source_info: json.dumps(data_source_info)}

        DocumentModel.query.filter_by(id=document_model.id).update(update_params)
        db.session.commit()

    @classmethod
    def _get_app_info(cls, tenant_id: str, feishu_workspace_id: str) -> (str, str):
        data_source_binding = DataSourceOauthBinding.query.filter(
            db.and_(
                DataSourceOauthBinding.tenant_id == tenant_id,
                DataSourceOauthBinding.provider == "feishuwiki",
                DataSourceOauthBinding.disabled == False,
                DataSourceOauthBinding.source_info["workspace_id"] == f'"{feishu_workspace_id}"',
            )
        ).first()

        if not data_source_binding:
            raise Exception(
                f"No feishuwiki data source binding found for tenant {tenant_id} "
                f"and feishuwiki workspace {feishu_workspace_id}"
            )

        app_id = data_source_binding.source_info["workspace_name"]
        app_secret = data_source_binding.access_token

        return app_id, app_secret
