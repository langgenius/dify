from langchain.callbacks import CallbackManager
from llama_index import ServiceContext, PromptHelper, LLMPredictor
from core.callback_handler.std_out_callback_handler import DifyStdOutCallbackHandler
from core.embedding.openai_embedding import OpenAIEmbedding
from core.llm.llm_builder import LLMBuilder


class IndexBuilder:
    @classmethod
    def get_default_service_context(cls, tenant_id: str) -> ServiceContext:
        # set number of output tokens
        num_output = 512

        # only for verbose
        callback_manager = CallbackManager([DifyStdOutCallbackHandler()])

        llm = LLMBuilder.to_llm(
            tenant_id=tenant_id,
            model_name='text-davinci-003',
            temperature=0,
            max_tokens=num_output,
            callback_manager=callback_manager,
        )

        llm_predictor = LLMPredictor(llm=llm)

        # These parameters here will affect the logic of segmenting the final synthesized response.
        # The number of refinement iterations in the synthesis process depends
        # on whether the length of the segmented output exceeds the max_input_size.
        prompt_helper = PromptHelper(
            max_input_size=3500,
            num_output=num_output,
            max_chunk_overlap=20
        )

        provider = LLMBuilder.get_default_provider(tenant_id)

        model_credentials = LLMBuilder.get_model_credentials(
            tenant_id=tenant_id,
            model_provider=provider,
            model_name='text-embedding-ada-002'
        )

        return ServiceContext.from_defaults(
            llm_predictor=llm_predictor,
            prompt_helper=prompt_helper,
            embed_model=OpenAIEmbedding(**model_credentials),
        )

    @classmethod
    def get_fake_llm_service_context(cls, tenant_id: str) -> ServiceContext:
        llm = LLMBuilder.to_llm(
            tenant_id=tenant_id,
            model_name='fake'
        )

        return ServiceContext.from_defaults(
            llm_predictor=LLMPredictor(llm=llm),
            embed_model=OpenAIEmbedding()
        )
