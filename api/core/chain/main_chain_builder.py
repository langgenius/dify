from typing import Optional, List, cast, Tuple

from langchain.chains import SequentialChain
from langchain.chains.base import Chain
from langchain.memory.chat_memory import BaseChatMemory

from core.callback_handler.main_chain_gather_callback_handler import MainChainGatherCallbackHandler
from core.callback_handler.std_out_callback_handler import DifyStdOutCallbackHandler
from core.chain.multi_dataset_router_chain import MultiDatasetRouterChain
from core.conversation_message_task import ConversationMessageTask
from core.orchestrator_rule_parser import OrchestratorRuleParser
from extensions.ext_database import db
from models.dataset import Dataset
from models.model import AppModelConfig


class MainChainBuilder:
    @classmethod
    def get_chains(cls, tenant_id: str, app_model_config: AppModelConfig, memory: Optional[BaseChatMemory],
                                rest_tokens: int, conversation_message_task: ConversationMessageTask):
        first_input_key = "input"
        final_output_key = "output"

        chains = []

        # init orchestrator rule parser
        orchestrator_rule_parser = OrchestratorRuleParser(
            tenant_id=tenant_id,
            app_model_config=app_model_config
        )

        # parse sensitive_word_avoidance_chain
        sensitive_word_avoidance_chain = orchestrator_rule_parser.to_sensitive_word_avoidance_chain()
        if sensitive_word_avoidance_chain:
            chains.append(sensitive_word_avoidance_chain)

        # parse agent chain
        agent_chain = cls.get_agent_chain(
            tenant_id=tenant_id,
            agent_mode=app_model_config.agent_mode_dict,
            rest_tokens=rest_tokens,
            memory=memory,
            conversation_message_task=conversation_message_task
        )

        if agent_chain:
            chains.append(agent_chain)
            final_output_key = agent_chain.output_keys[0]

        if len(chains) == 0:
            return None

        chain_callback = MainChainGatherCallbackHandler(conversation_message_task)
        for chain in chains:
            chain = cast(Chain, chain)
            chain.callbacks.append(chain_callback)

        # build main chain
        overall_chain = SequentialChain(
            chains=chains,
            input_variables=[first_input_key],
            output_variables=[final_output_key],
            memory=memory,  # only for use the memory prompt input key
        )

        return overall_chain

    @classmethod
    def get_agent_chain(cls, tenant_id: str, agent_mode: dict,
                        rest_tokens: int,
                        memory: Optional[BaseChatMemory],
                        conversation_message_task: ConversationMessageTask) -> Chain:
        # agent mode
        chain = None
        if agent_mode and agent_mode.get('enabled'):
            tools = agent_mode.get('tools', [])

            datasets = []
            for tool in tools:
                tool_type = list(tool.keys())[0]
                tool_config = list(tool.values())[0]
                if tool_type == "dataset":
                    # get dataset from dataset id
                    dataset = db.session.query(Dataset).filter(
                        Dataset.tenant_id == tenant_id,
                        Dataset.id == tool_config.get("id")
                    ).first()

                    if dataset:
                        datasets.append(dataset)

            if len(datasets) > 0:
                # tool to chain
                multi_dataset_router_chain = MultiDatasetRouterChain.from_datasets(
                    tenant_id=tenant_id,
                    datasets=datasets,
                    conversation_message_task=conversation_message_task,
                    rest_tokens=rest_tokens,
                    callbacks=[DifyStdOutCallbackHandler()]
                )
                chain = multi_dataset_router_chain

        return chain
