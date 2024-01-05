from typing import List

from core.tools.tool_manager import ToolManager
from core.tools.entities.user_entities import UserToolProvider
from core.tools.errors import AssistantProviderCredentialValidationError, AssistantNotFoundError, AssistantToolNotFoundError

from extensions.ext_database import db
from models.tools import AssistantBuiltinToolProvider

import json

class ToolManageService:
    @staticmethod
    def list_tool_providers(user_id: str, tanent_id: str):
        """
            list tool providers

            :return: the list of tool providers
        """
        return [
            provider.to_dict() for provider in ToolManager.user_list_providers(
                user_id,
                tanent_id,
            )
        ]
    
    @staticmethod
    def list_builtin_provider_credentails_schema(
        provider_name
    ):
        """
            list builtin provider credentials schema

            :return: the list of tool providers
        """
        provider = ToolManager.get_builtin_provider(provider_name)
        return [
            v.to_dict() for _, v in provider.credentials_schema.items()
        ]

    @staticmethod
    def create_tool_provider(
        user_id: str, tenant_id: str, provider_type: str, provider_name: str, credentails: dict
    ):
        if provider_type == UserToolProvider.ProviderType.BUILTIN.value:
            ToolManageService.create_builtin_tool_provider(
                user_id,
                tenant_id,
                provider_type,
                provider_name,
                credentails,
            )
        else:
            raise ValueError(f'provider type {provider_type} not supported')

        return {'status': 'success'}

    @staticmethod
    def create_builtin_tool_provider(
        user_id: str, tenant_id: str, provider_type: str, provider_name: str, credentails: dict
    ):
        # get if the provider exists
        provider: AssistantBuiltinToolProvider = db.session.query(AssistantBuiltinToolProvider).filter(
            AssistantBuiltinToolProvider.tenant_id == tenant_id,
            AssistantBuiltinToolProvider.provider == provider_name,
        ).first()

        if provider is not None:
            raise ValueError(f'provider {provider_name} already exists')
        
        try: 
            # get provider
            provider = ToolManager.get_builtin_provider(provider_name)
            # validate credentials
            provider.validate_credentials(credentails)
        except (AssistantNotFoundError, AssistantToolNotFoundError, AssistantProviderCredentialValidationError) as e:
            raise ValueError(str(e))

        # create provider
        provider = AssistantBuiltinToolProvider(
            tenant_id=tenant_id,
            user_id=user_id,
            provider=provider_name,
            encrypted_credentials=json.dumps(credentails),
        )

        db.session.add(provider)
        db.session.commit()