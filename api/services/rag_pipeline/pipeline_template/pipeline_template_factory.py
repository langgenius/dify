from services.rag_pipeline.pipeline_template.built_in.built_in_retrieval import BuiltInPipelineTemplateRetrieval
from services.rag_pipeline.pipeline_template.customized.customized_retrieval import CustomizedPipelineTemplateRetrieval
from services.rag_pipeline.pipeline_template.database.database_retrieval import DatabasePipelineTemplateRetrieval
from services.rag_pipeline.pipeline_template.pipeline_template_base import PipelineTemplateRetrievalBase
from services.rag_pipeline.pipeline_template.pipeline_template_type import PipelineTemplateType
from services.rag_pipeline.pipeline_template.remote.remote_retrieval import RemotePipelineTemplateRetrieval


class PipelineTemplateRetrievalFactory:
    @staticmethod
    def get_pipeline_template_factory(mode: str) -> type[PipelineTemplateRetrievalBase]:
        match mode:
            case PipelineTemplateType.REMOTE:
                return RemotePipelineTemplateRetrieval
            case PipelineTemplateType.CUSTOMIZED:
                return CustomizedPipelineTemplateRetrieval
            case PipelineTemplateType.DATABASE:
                return DatabasePipelineTemplateRetrieval
            case PipelineTemplateType.BUILTIN:
                return BuiltInPipelineTemplateRetrieval
            case _:
                raise ValueError(f"invalid fetch recommended apps mode: {mode}")

    @staticmethod
    def get_built_in_pipeline_template_retrieval():
        return BuiltInPipelineTemplateRetrieval
