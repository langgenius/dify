from typing import Optional

from langchain import LLMChain
from langchain.agents import ZeroShotAgent, AgentExecutor, ConversationalAgent
from langchain.callbacks import CallbackManager
from langchain.memory.chat_memory import BaseChatMemory

from core.callback_handler.agent_loop_gather_callback_handler import AgentLoopGatherCallbackHandler
from core.callback_handler.dataset_tool_callback_handler import DatasetToolCallbackHandler
from core.callback_handler.std_out_callback_handler import DifyStdOutCallbackHandler
from core.llm.llm_builder import LLMBuilder


class AgentBuilder:
    @classmethod
    def to_agent_chain(cls, tenant_id: str, tools, memory: Optional[BaseChatMemory],
                       dataset_tool_callback_handler: DatasetToolCallbackHandler,
                       agent_loop_gather_callback_handler: AgentLoopGatherCallbackHandler):
        llm_callback_manager = CallbackManager([agent_loop_gather_callback_handler, DifyStdOutCallbackHandler()])
        llm = LLMBuilder.to_llm(
            tenant_id=tenant_id,
            model_name=agent_loop_gather_callback_handler.model_name,
            temperature=0,
            max_tokens=1024,
            callback_manager=llm_callback_manager
        )

        tool_callback_manager = CallbackManager([
            agent_loop_gather_callback_handler,
            dataset_tool_callback_handler,
            DifyStdOutCallbackHandler()
        ])

        for tool in tools:
            tool.callback_manager = tool_callback_manager

        prompt = cls.build_agent_prompt_template(
            tools=tools,
            memory=memory,
        )

        agent_llm_chain = LLMChain(
            llm=llm,
            prompt=prompt,
        )

        agent = cls.build_agent(agent_llm_chain=agent_llm_chain, memory=memory)

        agent_callback_manager = CallbackManager(
            [agent_loop_gather_callback_handler, DifyStdOutCallbackHandler()]
        )

        agent_chain = AgentExecutor.from_agent_and_tools(
            tools=tools,
            agent=agent,
            memory=memory,
            callback_manager=agent_callback_manager,
            max_iterations=6,
            early_stopping_method="generate",
            # `generate` will continue to complete the last inference after reaching the iteration limit or request time limit
        )

        return agent_chain

    @classmethod
    def build_agent_prompt_template(cls, tools, memory: Optional[BaseChatMemory]):
        if memory:
            prompt = ConversationalAgent.create_prompt(
                tools=tools,
            )
        else:
            prompt = ZeroShotAgent.create_prompt(
                tools=tools,
            )

        return prompt

    @classmethod
    def build_agent(cls, agent_llm_chain: LLMChain, memory: Optional[BaseChatMemory]):
        if memory:
            agent = ConversationalAgent(
                llm_chain=agent_llm_chain
            )
        else:
            agent = ZeroShotAgent(
                llm_chain=agent_llm_chain
            )

        return agent
