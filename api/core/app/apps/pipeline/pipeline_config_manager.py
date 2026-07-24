from core.app.app_config.base_app_config_manager import BaseAppConfigManager
from core.app.app_config.common.sensitive_word_avoidance.manager import SensitiveWordAvoidanceConfigManager
from core.app.app_config.entities import RagPipelineVariableEntity, WorkflowUIBasedAppConfig
from core.app.app_config.features.file_upload.manager import FileUploadConfigManager
from core.app.app_config.features.text_to_speech.manager import TextToSpeechConfigManager
from core.app.app_config.workflow_ui_based_app.variables.manager import WorkflowVariablesConfigManager
from models.dataset import Pipeline
from models.model import AppMode
from models.workflow import Workflow


class PipelineConfig(WorkflowUIBasedAppConfig):
    """
    Pipeline Config Entity.
    """

    rag_pipeline_variables: list[RagPipelineVariableEntity] = []
    pass


class PipelineConfigManager(BaseAppConfigManager):
    @classmethod
    def get_pipeline_config(cls, pipeline: Pipeline, workflow: Workflow, start_node_id: str) -> PipelineConfig:
        pipeline_config = PipelineConfig(
            tenant_id=pipeline.tenant_id,
            app_id=pipeline.id,
            app_mode=AppMode.RAG_PIPELINE,
            workflow_id=workflow.id,
            rag_pipeline_variables=WorkflowVariablesConfigManager.convert_rag_pipeline_variable(
                workflow=workflow, start_node_id=start_node_id
            ),
        )

        return pipeline_config

    @classmethod
    def config_validate(cls, tenant_id: str, config: dict, only_structure_validate: bool = False) -> dict:
        """
        Validate for pipeline config

        :param tenant_id: tenant id
        :param config: app model config args
        :param only_structure_validate: only validate the structure of the config
        """
        related_config_keys = []

        # file upload validation
        config, current_related_config_keys = FileUploadConfigManager.validate_and_set_defaults(config=config)
        related_config_keys.extend(current_related_config_keys)

        # text_to_speech
        config, current_related_config_keys = TextToSpeechConfigManager.validate_and_set_defaults(config)
        related_config_keys.extend(current_related_config_keys)

        # moderation validation
        config, current_related_config_keys = SensitiveWordAvoidanceConfigManager.validate_and_set_defaults(
            tenant_id=tenant_id, config=config, only_structure_validate=only_structure_validate
        )
        related_config_keys.extend(current_related_config_keys)

        related_config_keys = list(set(related_config_keys))

        # Filter out extra parameters
        filtered_config = {key: config.get(key) for key in related_config_keys}

        return filtered_config
