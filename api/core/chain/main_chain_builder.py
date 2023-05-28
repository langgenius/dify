from typing import Optional, List

from langchain.callbacks import SharedCallbackManager, CallbackManager
from langchain.chains import SequentialChain
from langchain.chains.base import Chain
from langchain.memory.chat_memory import BaseChatMemory

from core.callback_handler.agent_loop_gather_callback_handler import AgentLoopGatherCallbackHandler
from core.callback_handler.main_chain_gather_callback_handler import MainChainGatherCallbackHandler
from core.callback_handler.std_out_callback_handler import DifyStdOutCallbackHandler
from core.chain.chain_builder import ChainBuilder
from core.chain.multi_dataset_router_chain import MultiDatasetRouterChain
from core.conversation_message_task import ConversationMessageTask
from extensions.ext_database import db
from models.dataset import Dataset


class MainChainBuilder:
    @classmethod
    def to_langchain_components(cls, tenant_id: str, agent_mode: dict, memory: Optional[BaseChatMemory],
                                conversation_message_task: ConversationMessageTask):
        first_input_key = "input"
        final_output_key = "output"

        chains = []

        chain_callback_handler = MainChainGatherCallbackHandler(conversation_message_task)

        # agent mode
        tool_chains, chains_output_key = cls.get_agent_chains(
            tenant_id=tenant_id,
            agent_mode=agent_mode,
            memory=memory,
            conversation_message_task=conversation_message_task
        )
        chains += tool_chains

        if chains_output_key:
            final_output_key = chains_output_key

        if len(chains) == 0:
            return None

        for chain in chains:
            # do not add handler into singleton callback manager
            if not isinstance(chain.callback_manager, SharedCallbackManager):
                chain.callback_manager.add_handler(chain_callback_handler)

        # build main chain
        overall_chain = SequentialChain(
            chains=chains,
            input_variables=[first_input_key],
            output_variables=[final_output_key],
            memory=memory,  # only for use the memory prompt input key
        )

        return overall_chain

    @classmethod
    def get_agent_chains(cls, tenant_id: str, agent_mode: dict, memory: Optional[BaseChatMemory],
                         conversation_message_task: ConversationMessageTask):
        # agent mode
        chains = []
        if agent_mode and agent_mode.get('enabled'):
            tools = agent_mode.get('tools', [])

            pre_fixed_chains = []
            # agent_tools = []
            datasets = []
            for tool in tools:
                tool_type = list(tool.keys())[0]
                tool_config = list(tool.values())[0]
                if tool_type == 'sensitive-word-avoidance':
                    chain = ChainBuilder.to_sensitive_word_avoidance_chain(tool_config)
                    if chain:
                        pre_fixed_chains.append(chain)
                elif tool_type == "dataset":
                    # get dataset from dataset id
                    dataset = db.session.query(Dataset).filter(
                        Dataset.tenant_id == tenant_id,
                        Dataset.id == tool_config.get("id")
                    ).first()

                    if dataset:
                        datasets.append(dataset)

            # add pre-fixed chains
            chains += pre_fixed_chains

            if len(datasets) > 0:
                # tool to chain
                multi_dataset_router_chain = MultiDatasetRouterChain.from_datasets(
                    tenant_id=tenant_id,
                    datasets=datasets,
                    conversation_message_task=conversation_message_task,
                    callback_manager=CallbackManager([DifyStdOutCallbackHandler()])
                )
                chains.append(multi_dataset_router_chain)

        final_output_key = cls.get_chains_output_key(chains)

        return chains, final_output_key

    @classmethod
    def get_chains_output_key(cls, chains: List[Chain]):
        if len(chains) > 0:
            return chains[-1].output_keys[0]
        return None
