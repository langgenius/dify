from services.rag_pipeline.pipeline_template.pipeline_template_base import PipelineTemplateRetrievalBase
from services.rag_pipeline.pipeline_template.pipeline_template_type import PipelineTemplateType



class RecommendAppRetrievalFactory:
    @staticmethod
    def get_pipeline_template_factory(mode: str) -> type[PipelineTemplateRetrievalBase]:
        match mode:
            case PipelineTemplateType.REMOTE:
                return RemotePipelineTemplateRetrieval
            case PipelineTemplateType.CUSTOMIZED:
                return DatabasePipelineTemplateRetrieval
            case PipelineTemplateType.BUILTIN:
                return BuildInPipelineTemplateRetrieval
            case _:
                raise ValueError(f"invalid fetch recommended apps mode: {mode}")

    @staticmethod
    def get_buildin_recommend_app_retrieval():
        return BuildInRecommendAppRetrieval
