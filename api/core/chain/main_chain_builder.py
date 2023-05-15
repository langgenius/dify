from typing import Optional, List

from langchain.callbacks import SharedCallbackManager
from langchain.chains import SequentialChain
from langchain.chains.base import Chain
from langchain.memory.chat_memory import BaseChatMemory

from core.agent.agent_builder import AgentBuilder
from core.callback_handler.agent_loop_gather_callback_handler import AgentLoopGatherCallbackHandler
from core.callback_handler.dataset_tool_callback_handler import DatasetToolCallbackHandler
from core.callback_handler.main_chain_gather_callback_handler import MainChainGatherCallbackHandler
from core.chain.chain_builder import ChainBuilder
from core.constant import llm_constant
from core.conversation_message_task import ConversationMessageTask
from core.tool.dataset_tool_builder import DatasetToolBuilder


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
            dataset_tool_callback_handler=DatasetToolCallbackHandler(conversation_message_task),
            agent_loop_gather_callback_handler=chain_callback_handler.agent_loop_gather_callback_handler
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
                         dataset_tool_callback_handler: DatasetToolCallbackHandler,
                         agent_loop_gather_callback_handler: AgentLoopGatherCallbackHandler):
        # agent mode
        chains = []
        if agent_mode and agent_mode.get('enabled'):
            tools = agent_mode.get('tools', [])

            pre_fixed_chains = []
            agent_tools = []
            for tool in tools:
                tool_type = list(tool.keys())[0]
                tool_config = list(tool.values())[0]
                if tool_type == 'sensitive-word-avoidance':
                    chain = ChainBuilder.to_sensitive_word_avoidance_chain(tool_config)
                    if chain:
                        pre_fixed_chains.append(chain)
                elif tool_type == "dataset":
                    dataset_tool = DatasetToolBuilder.build_dataset_tool(
                        tenant_id=tenant_id,
                        dataset_id=tool_config.get("id"),
                        response_mode='no_synthesizer',  # "compact"
                        callback_handler=dataset_tool_callback_handler
                    )

                    if dataset_tool:
                        agent_tools.append(dataset_tool)

            # add pre-fixed chains
            chains += pre_fixed_chains

            if len(agent_tools) == 1:
                # tool to chain
                tool_chain = ChainBuilder.to_tool_chain(tool=agent_tools[0], output_key='tool_output')
                chains.append(tool_chain)
            elif len(agent_tools) > 1:
                # build agent config
                agent_chain = AgentBuilder.to_agent_chain(
                    tenant_id=tenant_id,
                    tools=agent_tools,
                    memory=memory,
                    dataset_tool_callback_handler=dataset_tool_callback_handler,
                    agent_loop_gather_callback_handler=agent_loop_gather_callback_handler
                )

                chains.append(agent_chain)

        final_output_key = cls.get_chains_output_key(chains)

        return chains, final_output_key

    @classmethod
    def get_chains_output_key(cls, chains: List[Chain]):
        if len(chains) > 0:
            return chains[-1].output_keys[0]
        return None
