from enum import Enum
from typing import Any, Literal, Optional, Union

from pydantic import BaseModel

from core.entities.provider_configuration import ProviderModelBundle
from core.file.file_obj import FileObj
from core.model_runtime.entities.message_entities import PromptMessageRole
from core.model_runtime.entities.model_entities import AIModelEntity


class ModelConfigEntity(BaseModel):
    """
    Model Config Entity.
    """
    provider: str
    model: str
    model_schema: AIModelEntity
    mode: str
    provider_model_bundle: ProviderModelBundle
    credentials: dict[str, Any] = {}
    parameters: dict[str, Any] = {}
    stop: list[str] = []


class AdvancedChatMessageEntity(BaseModel):
    """
    Advanced Chat Message Entity.
    """
    text: str
    role: PromptMessageRole


class AdvancedChatPromptTemplateEntity(BaseModel):
    """
    Advanced Chat Prompt Template Entity.
    """
    messages: list[AdvancedChatMessageEntity]


class AdvancedCompletionPromptTemplateEntity(BaseModel):
    """
    Advanced Completion Prompt Template Entity.
    """

    class RolePrefixEntity(BaseModel):
        """
        Role Prefix Entity.
        """
        user: str
        assistant: str

    prompt: str
    role_prefix: Optional[RolePrefixEntity] = None


class PromptTemplateEntity(BaseModel):
    """
    Prompt Template Entity.
    """

    class PromptType(Enum):
        """
        Prompt Type.
        'simple', 'advanced'
        """
        SIMPLE = 'simple'
        ADVANCED = 'advanced'

        @classmethod
        def value_of(cls, value: str) -> 'PromptType':
            """
            Get value of given mode.

            :param value: mode value
            :return: mode
            """
            for mode in cls:
                if mode.value == value:
                    return mode
            raise ValueError(f'invalid prompt type value {value}')

    prompt_type: PromptType
    simple_prompt_template: Optional[str] = None
    advanced_chat_prompt_template: Optional[AdvancedChatPromptTemplateEntity] = None
    advanced_completion_prompt_template: Optional[AdvancedCompletionPromptTemplateEntity] = None


class ExternalDataVariableEntity(BaseModel):
    """
    External Data Variable Entity.
    """
    variable: str
    type: str
    config: dict[str, Any] = {}


class DatasetRetrieveConfigEntity(BaseModel):
    """
    Dataset Retrieve Config Entity.
    """

    class RetrieveStrategy(Enum):
        """
        Dataset Retrieve Strategy.
        'single' or 'multiple'
        """
        SINGLE = 'single'
        MULTIPLE = 'multiple'

        @classmethod
        def value_of(cls, value: str) -> 'RetrieveStrategy':
            """
            Get value of given mode.

            :param value: mode value
            :return: mode
            """
            for mode in cls:
                if mode.value == value:
                    return mode
            raise ValueError(f'invalid retrieve strategy value {value}')

    query_variable: Optional[str] = None  # Only when app mode is completion

    retrieve_strategy: RetrieveStrategy
    single_strategy: Optional[str] = None  # for temp
    top_k: Optional[int] = None
    score_threshold: Optional[float] = None
    reranking_model: Optional[dict] = None


class DatasetEntity(BaseModel):
    """
    Dataset Config Entity.
    """
    dataset_ids: list[str]
    retrieve_config: DatasetRetrieveConfigEntity


class SensitiveWordAvoidanceEntity(BaseModel):
    """
    Sensitive Word Avoidance Entity.
    """
    type: str
    config: dict[str, Any] = {}


class TextToSpeechEntity(BaseModel):
    """
    Sensitive Word Avoidance Entity.
    """
    enabled: bool
    voice: Optional[str] = None
    language: Optional[str] = None


class FileUploadEntity(BaseModel):
    """
    File Upload Entity.
    """
    image_config: Optional[dict[str, Any]] = None


class AgentToolEntity(BaseModel):
    """
    Agent Tool Entity.
    """
    provider_type: Literal["builtin", "api"]
    provider_id: str
    tool_name: str
    tool_parameters: dict[str, Any] = {}


class AgentPromptEntity(BaseModel):
    """
    Agent Prompt Entity.
    """
    first_prompt: str
    next_iteration: str


class AgentScratchpadUnit(BaseModel):
    """
    Agent First Prompt Entity.
    """

    class Action(BaseModel):
        """
        Action Entity.
        """
        action_name: str
        action_input: Union[dict, str]

    agent_response: Optional[str] = None
    thought: Optional[str] = None
    action_str: Optional[str] = None
    observation: Optional[str] = None
    action: Optional[Action] = None


class AgentEntity(BaseModel):
    """
    Agent Entity.
    """

    class Strategy(Enum):
        """
        Agent Strategy.
        """
        CHAIN_OF_THOUGHT = 'chain-of-thought'
        FUNCTION_CALLING = 'function-calling'

    provider: str
    model: str
    strategy: Strategy
    prompt: Optional[AgentPromptEntity] = None
    tools: list[AgentToolEntity] = None
    max_iteration: int = 5


class AppOrchestrationConfigEntity(BaseModel):
    """
    App Orchestration Config Entity.
    """
    model_config: ModelConfigEntity
    prompt_template: PromptTemplateEntity
    external_data_variables: list[ExternalDataVariableEntity] = []
    agent: Optional[AgentEntity] = None

    # features
    dataset: Optional[DatasetEntity] = None
    file_upload: Optional[FileUploadEntity] = None
    opening_statement: Optional[str] = None
    suggested_questions_after_answer: bool = False
    show_retrieve_source: bool = False
    more_like_this: bool = False
    speech_to_text: bool = False
    text_to_speech: dict = {}
    sensitive_word_avoidance: Optional[SensitiveWordAvoidanceEntity] = None


class InvokeFrom(Enum):
    """
    Invoke From.
    """
    SERVICE_API = 'service-api'
    WEB_APP = 'web-app'
    EXPLORE = 'explore'
    DEBUGGER = 'debugger'

    @classmethod
    def value_of(cls, value: str) -> 'InvokeFrom':
        """
        Get value of given mode.

        :param value: mode value
        :return: mode
        """
        for mode in cls:
            if mode.value == value:
                return mode
        raise ValueError(f'invalid invoke from value {value}')

    def to_source(self) -> str:
        """
        Get source of invoke from.

        :return: source
        """
        if self == InvokeFrom.WEB_APP:
            return 'web_app'
        elif self == InvokeFrom.DEBUGGER:
            return 'dev'
        elif self == InvokeFrom.EXPLORE:
            return 'explore_app'
        elif self == InvokeFrom.SERVICE_API:
            return 'api'

        return 'dev'


class ApplicationGenerateEntity(BaseModel):
    """
    Application Generate Entity.
    """
    task_id: str
    tenant_id: str

    app_id: str
    app_model_config_id: str
    # for save
    app_model_config_dict: dict
    app_model_config_override: bool

    # Converted from app_model_config to Entity object, or directly covered by external input
    app_orchestration_config_entity: AppOrchestrationConfigEntity

    conversation_id: Optional[str] = None
    inputs: dict[str, str]
    query: Optional[str] = None
    files: list[FileObj] = []
    user_id: str
    # extras
    stream: bool
    invoke_from: InvokeFrom

    # extra parameters, like: auto_generate_conversation_name
    extras: dict[str, Any] = {}
