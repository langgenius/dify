# from typing import Optional, List, cast, Tuple
#
# from langchain.chains import SequentialChain
# from langchain.chains.base import Chain
# from langchain.memory.chat_memory import BaseChatMemory
#
# from core.callback_handler.main_chain_gather_callback_handler import MainChainGatherCallbackHandler
# from core.callback_handler.std_out_callback_handler import DifyStdOutCallbackHandler
# from core.chain.multi_dataset_router_chain import MultiDatasetRouterChain
# from core.conversation_message_task import ConversationMessageTask
# from core.orchestrator_rule_parser import OrchestratorRuleParser
# from extensions.ext_database import db
# from models.dataset import Dataset
# from models.model import AppModelConfig
#
#
# class MainChainBuilder:
#     @classmethod
#     def get_chains(cls, tenant_id: str, app_model_config: AppModelConfig, memory: Optional[BaseChatMemory],
#                    rest_tokens: int, conversation_message_task: ConversationMessageTask):
#         first_input_key = "input"
#         final_output_key = "output"
#
#         chains = []
#
#         # init orchestrator rule parser
#         orchestrator_rule_parser = OrchestratorRuleParser(
#             tenant_id=tenant_id,
#             app_model_config=app_model_config
#         )
#
#         # parse sensitive_word_avoidance_chain
#         sensitive_word_avoidance_chain = orchestrator_rule_parser.to_sensitive_word_avoidance_chain()
#         if sensitive_word_avoidance_chain:
#             chains.append(sensitive_word_avoidance_chain)
#
#         # parse agent chain
#         agent_executor = orchestrator_rule_parser.to_agent_executor(
#             conversation_message_task=conversation_message_task,
#             memory=memory,
#             rest_tokens=rest_tokens,
#             callbacks=[DifyStdOutCallbackHandler()]
#         )
#
#         if agent_executor:
#             if isinstance(agent_executor, MultiDatasetRouterChain):
#                 chains.append(agent_executor)
#                 final_output_key = agent_executor.output_keys[0]
#             chains.append(agent_chain)
#             final_output_key = agent_chain.output_keys[0]
#
#         if len(chains) == 0:
#             return None
#
#         chain_callback = MainChainGatherCallbackHandler(conversation_message_task)
#         for chain in chains:
#             chain = cast(Chain, chain)
#             chain.callbacks.append(chain_callback)
#
#         # build main chain
#         overall_chain = SequentialChain(
#             chains=chains,
#             input_variables=[first_input_key],
#             output_variables=[final_output_key],
#             memory=memory,  # only for use the memory prompt input key
#         )
#
#         return overall_chain
