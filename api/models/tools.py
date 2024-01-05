import json
from enum import Enum
from typing import Union, List

from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy import ForeignKey

from extensions.ext_database import db

from core.tools.entities.assistant_bundle import AssistantApiBasedToolBundle
from core.tools.entities.common_entities import I18nObject


class AssistantBuiltinToolProvider(db.Model):
    """
    This table stores the tool provider information for built-in tools for each tenant.
    """
    __tablename__ = 'assistant_tool_providers'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='assistant_tool_provider_pkey'),
        # one tenant can only have one tool provider with the same name
        db.UniqueConstraint('tenant_id', 'provider', name='unique_assistant_tool_provider')
    )

    # id of the tool provider
    id = db.Column(UUID, server_default=db.text('uuid_generate_v4()'))
    # id of the tenant
    tenant_id = db.Column(UUID, nullable=False)
    # who created this tool provider
    user_id = db.Column(UUID, nullable=False)
    # name of the tool provider
    provider = db.Column(db.String(40), nullable=False)
    # credential of the tool provider
    encrypted_credentials = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    updated_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))

class AssistantAppTool(db.Model):
    """
    The table stores the apps published as a tool for each person.
    """
    __tablename__ = 'assistant_app_tools'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='assistant_app_tool_pkey'),
        db.UniqueConstraint('app_id', 'user_id', name='unique_app_tool')
    )

    # id of the tool provider
    id = db.Column(UUID, server_default=db.text('uuid_generate_v4()'))
    # id of the app
    app_id = db.Column(UUID, ForeignKey('apps.id'), nullable=False)
    app = db.relationship('App', backref=db.backref('assistant_app_tool', uselist=False))
    # who published this tool
    user_id = db.Column(UUID, nullable=False)
    # description of the tool, stored in i18n format, for human
    description = db.Column(db.Text, nullable=False)
    # llm_description of the tool, for LLM
    llm_description = db.Column(db.Text, nullable=False)
    # query decription, query will be seem as a parameter of the tool, to describe this parameter to llm, we need this field
    query_description = db.Column(db.Text, nullable=False)
    # query name, the name of the query parameter
    query_name = db.Column(db.String(40), nullable=False)
    # name of the tool provider
    tool_name = db.Column(db.String(40), nullable=False)
    # author
    author = db.Column(db.String(40), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))
    updated_at = db.Column(db.DateTime, nullable=False, server_default=db.text('CURRENT_TIMESTAMP(0)'))

    @property
    def description_i18n(self) -> I18nObject:
        return I18nObject(**json.loads(self.description))
    
class AssistantApiProviderSchemaType(Enum):
    """
    Enum class for assistant api provider schema type.
    """
    OPENAPI = "openapi"
    SWAGGER = "swagger"
    OPENAI_PLUGIN = "openai_plugin"
    OPENAI_ACTIONS = "openai_actions"

    @classmethod
    def value_of(cls, value: str) -> 'AssistantApiProviderSchemaType':
        """
        Get value of given mode.

        :param value: mode value
        :return: mode
        """
        for mode in cls:
            if mode.value == value:
                return mode
        raise ValueError(f'invalid mode value {value}')

class AssistantApiProvider(db.Model):
    """
    The table stores the api providers.
    """
    __tablename__ = 'assistant_api_providers'
    __table_args__ = (
        db.PrimaryKeyConstraint('id', name='assistant_api_provider_pkey'),
    )

    id = db.Column(UUID, server_default=db.text('uuid_generate_v4()'))
    # name of the api provider
    name = db.Column(db.String(40), nullable=False)
    # original schema
    schema = db.Column(db.Text, nullable=False)
    schema_type_str = db.Column(db.String(40), nullable=False)
    # who created this tool
    user_id = db.Column(UUID, nullable=False)
    # tanent id
    tenant_id = db.Column(UUID, nullable=False)
    # description of the provider
    description_str = db.Column(db.Text, nullable=False)
    # json format tools
    tools_str = db.Column(db.Text, nullable=False)
    # json format credentials
    credentials = db.Column(db.Text, nullable=False)

    @property
    def description(self) -> I18nObject:
        return I18nObject(**json.loads(self.description_str))
    
    @property
    def schema_type(self) -> AssistantApiProviderSchemaType:
        return AssistantApiProviderSchemaType.value_of(self.schema_type_str)
    
    @property
    def tools(self) -> List[AssistantApiBasedToolBundle]:
        return [AssistantApiBasedToolBundle(**tool) for tool in json.loads(self.tools_str)]
    
    @property
    def credentials(self) -> dict:
        return json.loads(self.credentials)