from typing import Optional

from core.moderation.base import Moderation
from extensions.ext_database import db
from models.api_based_extension import APIBasedExtension


class ApiModeration(Moderation):
    name: str = "api"

    @classmethod
    def validate_config(cls, tenant_id: str, config: dict) -> None:
        """
        Validate the incoming form config data.

        :param tenant_id: the id of workspace
        :param config: the form config data
        :return:
        """
        super().validate_config(tenant_id, config)
        cls._validate_inputs_and_outputs_config(config, False)

        api_based_extension_id = config.get("api_based_extension_id")
        if not api_based_extension_id:
            raise ValueError("api_based_extension_id is required")

        # get api_based_extension
        api_based_extension = db.session.query(APIBasedExtension).filter(
            APIBasedExtension.tenant_id == tenant_id,
            APIBasedExtension.id == api_based_extension_id
        ).first()

        if not api_based_extension:
            raise ValueError("api_based_extension_id is invalid")

    def moderation_for_inputs(self, inputs: dict, query: Optional[str] = None):
        pass

    def moderation_for_outputs(self, text: str):
        pass


        
