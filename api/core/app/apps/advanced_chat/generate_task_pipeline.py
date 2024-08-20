import json
import logging
import time
from collections.abc import Generator
from typing import Any, Optional, Union, cast

import contexts
from constants.tts_auto_play_timeout import TTS_AUTO_PLAY_TIMEOUT, TTS_AUTO_PLAY_YIELD_CPU_TIME
from core.app.apps.advanced_chat.app_generator_tts_publisher import AppGeneratorTTSPublisher, AudioTrunk
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.entities.app_invoke_entities import (
    AdvancedChatAppGenerateEntity,
)
from core.app.entities.queue_entities import (
    QueueAdvancedChatMessageEndEvent,
    QueueAnnotationReplyEvent,
    QueueErrorEvent,
    QueueIterationCompletedEvent,
    QueueIterationNextEvent,
    QueueIterationStartEvent,
    QueueMessageReplaceEvent,
    QueueNodeFailedEvent,
    QueueNodeStartedEvent,
    QueueNodeSucceededEvent,
    QueuePingEvent,
    QueueRetrieverResourcesEvent,
    QueueStopEvent,
    QueueTextChunkEvent,
    QueueWorkflowFailedEvent,
    QueueWorkflowStartedEvent,
    QueueWorkflowSucceededEvent,
)
from core.app.entities.task_entities import (
    AdvancedChatTaskState,
    ChatbotAppBlockingResponse,
    ChatbotAppStreamResponse,
    ChatflowStreamGenerateRoute,
    ErrorStreamResponse,
    MessageAudioEndStreamResponse,
    MessageAudioStreamResponse,
    MessageEndStreamResponse,
    StreamResponse,
)
from core.app.task_pipeline.based_generate_task_pipeline import BasedGenerateTaskPipeline
from core.app.task_pipeline.message_cycle_manage import MessageCycleManage
from core.app.task_pipeline.workflow_cycle_manage import WorkflowCycleManage
from core.file.file_obj import FileVar
from core.model_runtime.entities.llm_entities import LLMUsage
from core.model_runtime.utils.encoders import jsonable_encoder
from core.ops.ops_trace_manager import TraceQueueManager
from core.workflow.entities.node_entities import NodeType
from core.workflow.enums import SystemVariableKey
from core.workflow.nodes.answer.answer_node import AnswerNode
from core.workflow.nodes.answer.entities import TextGenerateRouteChunk, VarGenerateRouteChunk
from events.message_event import message_was_created
from extensions.ext_database import db
from models.account import Account
from models.model import Conversation, EndUser, Message
from models.workflow import (
    Workflow,
    WorkflowNodeExecution,
    WorkflowRunStatus,
)

logger = logging.getLogger(__name__)


class AdvancedChatAppGenerateTaskPipeline(BasedGenerateTaskPipeline, WorkflowCycleManage, MessageCycleManage):
    """
    AdvancedChatAppGenerateTaskPipeline is a class that generate stream output and state management for Application.
    """
    _task_state: AdvancedChatTaskState
    _application_generate_entity: AdvancedChatAppGenerateEntity
    _workflow: Workflow
    _user: Union[Account, EndUser]
    # Deprecated
    _workflow_system_variables: dict[SystemVariableKey, Any]
    _iteration_nested_relations: dict[str, list[str]]

    def __init__(
            self, application_generate_entity: AdvancedChatAppGenerateEntity,
            workflow: Workflow,
            queue_manager: AppQueueManager,
            conversation: Conversation,
            message: Message,
            user: Union[Account, EndUser],
            stream: bool,
    ) -> None:
        """
        Initialize AdvancedChatAppGenerateTaskPipeline.
        :param application_generate_entity: application generate entity
        :param workflow: workflow
        :param queue_manager: queue manager
        :param conversation: conversation
        :param message: message
        :param user: user
        :param stream: stream
        """
        super().__init__(application_generate_entity, queue_manager, user, stream)

        if isinstance(self._user, EndUser):
            user_id = self._user.session_id
        else:
            user_id = self._user.id

        self._workflow = workflow
        self._conversation = conversation
        self._message = message
        # Deprecated
        self._workflow_system_variables = {
            SystemVariableKey.QUERY: message.query,
            SystemVariableKey.FILES: application_generate_entity.files,
            SystemVariableKey.CONVERSATION_ID: conversation.id,
            SystemVariableKey.USER_ID: user_id,
        }

        self._task_state = AdvancedChatTaskState(
            usage=LLMUsage.empty_usage()
        )

        self._iteration_nested_relations = self._get_iteration_nested_relations(self._workflow.graph_dict)
        self._stream_generate_routes = self._get_stream_generate_routes()
        self._conversation_name_generate_thread = None

    def process(self):
        """
        Process generate task pipeline.
        :return:
        """
        db.session.refresh(self._workflow)
        db.session.refresh(self._user)
        db.session.close()

        # start generate conversation name thread
        self._conversation_name_generate_thread = self._generate_conversation_name(
            self._conversation,
            self._application_generate_entity.query
        )

        generator = self._wrapper_process_stream_response(
            trace_manager=self._application_generate_entity.trace_manager
        )
        if self._stream:
            return self._to_stream_response(generator)
        else:
            return self._to_blocking_response(generator)

    def _to_blocking_response(self, generator: Generator[StreamResponse, None, None]) -> ChatbotAppBlockingResponse:
        """
        Process blocking response.
        :return:
        """
        for stream_response in generator:
            if isinstance(stream_response, ErrorStreamResponse):
                raise stream_response.err
            elif isinstance(stream_response, MessageEndStreamResponse):
                extras = {}
                if stream_response.metadata:
                    extras['metadata'] = stream_response.metadata

                return ChatbotAppBlockingResponse(
                    task_id=stream_response.task_id,
                    data=ChatbotAppBlockingResponse.Data(
                        id=self._message.id,
                        mode=self._conversation.mode,
                        conversation_id=self._conversation.id,
                        message_id=self._message.id,
                        answer=self._task_state.answer,
                        created_at=int(self._message.created_at.timestamp()),
                        **extras
                    )
                )
            else:
                continue

        raise Exception('Queue listening stopped unexpectedly.')

    def _to_stream_response(self, generator: Generator[StreamResponse, None, None]) -> Generator[ChatbotAppStreamResponse, Any, None]:
        """
        To stream response.
        :return:
        """
        for stream_response in generator:
            yield ChatbotAppStreamResponse(
                conversation_id=self._conversation.id,
                message_id=self._message.id,
                created_at=int(self._message.created_at.timestamp()),
                stream_response=stream_response
            )

    def _listenAudioMsg(self, publisher, task_id: str):
        if not publisher:
            return None
        audio_msg: AudioTrunk = publisher.checkAndGetAudio()
        if audio_msg and audio_msg.status != "finish":
            return MessageAudioStreamResponse(audio=audio_msg.audio, task_id=task_id)
        return None

    def _wrapper_process_stream_response(self, trace_manager: Optional[TraceQueueManager] = None) -> \
            Generator[StreamResponse, None, None]:

        publisher = None
        task_id = self._application_generate_entity.task_id
        tenant_id = self._application_generate_entity.app_config.tenant_id
        features_dict = self._workflow.features_dict

        if features_dict.get('text_to_speech') and features_dict['text_to_speech'].get('enabled') and features_dict[
                'text_to_speech'].get('autoPlay') == 'enabled':
            publisher = AppGeneratorTTSPublisher(tenant_id, features_dict['text_to_speech'].get('voice'))
        for response in self._process_stream_response(publisher=publisher, trace_manager=trace_manager):
            while True:
                audio_response = self._listenAudioMsg(publisher, task_id=task_id)
                if audio_response:
                    yield audio_response
                else:
                    break
            yield response

        start_listener_time = time.time()
        # timeout
        while (time.time() - start_listener_time) < TTS_AUTO_PLAY_TIMEOUT:
            try:
                if not publisher:
                    break
                audio_trunk = publisher.checkAndGetAudio()
                if audio_trunk is None:
                    # release cpu
                    # sleep 20 ms ( 40ms => 1280 byte audio file,20ms => 640 byte audio file)
                    time.sleep(TTS_AUTO_PLAY_YIELD_CPU_TIME)
                    continue
                if audio_trunk.status == "finish":
                    break
                else:
                    start_listener_time = time.time()
                    yield MessageAudioStreamResponse(audio=audio_trunk.audio, task_id=task_id)
            except Exception as e:
                logger.error(e)
                break
        yield MessageAudioEndStreamResponse(audio='', task_id=task_id)

    def _process_stream_response(
            self,
            publisher: AppGeneratorTTSPublisher,
            trace_manager: Optional[TraceQueueManager] = None
    ) -> Generator[StreamResponse, None, None]:
        """
        Process stream response.
        :return:
        """
        for message in self._queue_manager.listen():
            if (message.event
                    and getattr(message.event, 'metadata', None)
                    and message.event.metadata.get('is_answer_previous_node', False)
                    and publisher):
                publisher.publish(message=message)
            elif (hasattr(message.event, 'execution_metadata')
                  and message.event.execution_metadata
                  and message.event.execution_metadata.get('is_answer_previous_node', False)
                  and publisher):
                publisher.publish(message=message)
            event = message.event

            if isinstance(event, QueueErrorEvent):
                err = self._handle_error(event, self._message)
                yield self._error_to_stream_response(err)
                break
            elif isinstance(event, QueueWorkflowStartedEvent):
                workflow_run = self._handle_workflow_start()

                self._message = db.session.query(Message).filter(Message.id == self._message.id).first()
                self._message.workflow_run_id = workflow_run.id

                db.session.commit()
                db.session.refresh(self._message)
                db.session.close()

                yield self._workflow_start_to_stream_response(
                    task_id=self._application_generate_entity.task_id,
                    workflow_run=workflow_run
                )
            elif isinstance(event, QueueNodeStartedEvent):
                workflow_node_execution = self._handle_node_start(event)

                # search stream_generate_routes if node id is answer start at node
                if not self._task_state.current_stream_generate_state and event.node_id in self._stream_generate_routes:
                    self._task_state.current_stream_generate_state = self._stream_generate_routes[event.node_id]
                    # reset current route position to 0
                    self._task_state.current_stream_generate_state.current_route_position = 0

                    # generate stream outputs when node started
                    yield from self._generate_stream_outputs_when_node_started()

                yield self._workflow_node_start_to_stream_response(
                    event=event,
                    task_id=self._application_generate_entity.task_id,
                    workflow_node_execution=workflow_node_execution
                )
            elif isinstance(event, QueueNodeSucceededEvent | QueueNodeFailedEvent):
                workflow_node_execution = self._handle_node_finished(event)

                # stream outputs when node finished
                generator = self._generate_stream_outputs_when_node_finished()
                if generator:
                    yield from generator

                yield self._workflow_node_finish_to_stream_response(
                    task_id=self._application_generate_entity.task_id,
                    workflow_node_execution=workflow_node_execution
                )

                if isinstance(event, QueueNodeFailedEvent):
                    yield from self._handle_iteration_exception(
                        task_id=self._application_generate_entity.task_id,
                        error=f'Child node failed: {event.error}'
                    )
            elif isinstance(event, QueueIterationStartEvent | QueueIterationNextEvent | QueueIterationCompletedEvent):
                if isinstance(event, QueueIterationNextEvent):
                    # clear ran node execution infos of current iteration
                    iteration_relations = self._iteration_nested_relations.get(event.node_id)
                    if iteration_relations:
                        for node_id in iteration_relations:
                            self._task_state.ran_node_execution_infos.pop(node_id, None)

                yield self._handle_iteration_to_stream_response(self._application_generate_entity.task_id, event)
                self._handle_iteration_operation(event)
            elif isinstance(event, QueueStopEvent | QueueWorkflowSucceededEvent | QueueWorkflowFailedEvent):
                workflow_run = self._handle_workflow_finished(
                    event, conversation_id=self._conversation.id, trace_manager=trace_manager
                )
                if workflow_run:
                    yield self._workflow_finish_to_stream_response(
                        task_id=self._application_generate_entity.task_id,
                        workflow_run=workflow_run
                    )

                    if workflow_run.status == WorkflowRunStatus.FAILED.value:
                        err_event = QueueErrorEvent(error=ValueError(f'Run failed: {workflow_run.error}'))
                        yield self._error_to_stream_response(self._handle_error(err_event, self._message))
                        break

                if isinstance(event, QueueStopEvent):
                    # Save message
                    self._save_message()

                    yield self._message_end_to_stream_response()
                    break
                else:
                    self._queue_manager.publish(
                        QueueAdvancedChatMessageEndEvent(),
                        PublishFrom.TASK_PIPELINE
                    )
            elif isinstance(event, QueueAdvancedChatMessageEndEvent):
                output_moderation_answer = self._handle_output_moderation_when_task_finished(self._task_state.answer)
                if output_moderation_answer:
                    self._task_state.answer = output_moderation_answer
                    yield self._message_replace_to_stream_response(answer=output_moderation_answer)

                # Save message
                self._save_message()

                yield self._message_end_to_stream_response()
            elif isinstance(event, QueueRetrieverResourcesEvent):
                self._handle_retriever_resources(event)
            elif isinstance(event, QueueAnnotationReplyEvent):
                self._handle_annotation_reply(event)
            elif isinstance(event, QueueTextChunkEvent):
                delta_text = event.text
                if delta_text is None:
                    continue

                if not self._is_stream_out_support(
                        event=event
                ):
                    continue

                # handle output moderation chunk
                should_direct_answer = self._handle_output_moderation_chunk(delta_text)
                if should_direct_answer:
                    continue

                self._task_state.answer += delta_text
                yield self._message_to_stream_response(delta_text, self._message.id)
            elif isinstance(event, QueueMessageReplaceEvent):
                yield self._message_replace_to_stream_response(answer=event.text)
            elif isinstance(event, QueuePingEvent):
                yield self._ping_stream_response()
            else:
                continue
        if publisher:
            publisher.publish(None)
        if self._conversation_name_generate_thread:
            self._conversation_name_generate_thread.join()

    def _save_message(self) -> None:
        """
        Save message.
        :return:
        """
        self._message = db.session.query(Message).filter(Message.id == self._message.id).first()

        self._message.answer = self._task_state.answer
        self._message.provider_response_latency = time.perf_counter() - self._start_at
        self._message.message_metadata = json.dumps(jsonable_encoder(self._task_state.metadata)) \
            if self._task_state.metadata else None

        if self._task_state.metadata and self._task_state.metadata.get('usage'):
            usage = LLMUsage(**self._task_state.metadata['usage'])

            self._message.message_tokens = usage.prompt_tokens
            self._message.message_unit_price = usage.prompt_unit_price
            self._message.message_price_unit = usage.prompt_price_unit
            self._message.answer_tokens = usage.completion_tokens
            self._message.answer_unit_price = usage.completion_unit_price
            self._message.answer_price_unit = usage.completion_price_unit
            self._message.total_price = usage.total_price
            self._message.currency = usage.currency

        db.session.commit()

        message_was_created.send(
            self._message,
            application_generate_entity=self._application_generate_entity,
            conversation=self._conversation,
            is_first_message=self._application_generate_entity.conversation_id is None,
            extras=self._application_generate_entity.extras
        )

    def _message_end_to_stream_response(self) -> MessageEndStreamResponse:
        """
        Message end to stream response.
        :return:
        """
        extras = {}
        if self._task_state.metadata:
            extras['metadata'] = self._task_state.metadata

        return MessageEndStreamResponse(
            task_id=self._application_generate_entity.task_id,
            id=self._message.id,
            **extras
        )

    def _get_stream_generate_routes(self) -> dict[str, ChatflowStreamGenerateRoute]:
        """
        Get stream generate routes.
        :return:
        """
        # find all answer nodes
        graph = self._workflow.graph_dict
        answer_node_configs = [
            node for node in graph['nodes']
            if node.get('data', {}).get('type') == NodeType.ANSWER.value
        ]

        # parse stream output node value selectors of answer nodes
        stream_generate_routes = {}
        for node_config in answer_node_configs:
            # get generate route for stream output
            answer_node_id = node_config['id']
            generate_route = AnswerNode.extract_generate_route_selectors(node_config)
            start_node_ids = self._get_answer_start_at_node_ids(graph, answer_node_id)
            if not start_node_ids:
                continue

            for start_node_id in start_node_ids:
                stream_generate_routes[start_node_id] = ChatflowStreamGenerateRoute(
                    answer_node_id=answer_node_id,
                    generate_route=generate_route
                )

        return stream_generate_routes

    def _get_answer_start_at_node_ids(self, graph: dict, target_node_id: str) \
            -> list[str]:
        """
        Get answer start at node id.
        :param graph: graph
        :param target_node_id: target node ID
        :return:
        """
        nodes = graph.get('nodes')
        edges = graph.get('edges')

        # fetch all ingoing edges from source node
        ingoing_edges = []
        for edge in edges:
            if edge.get('target') == target_node_id:
                ingoing_edges.append(edge)

        if not ingoing_edges:
            # check if it's the first node in the iteration
            target_node = next((node for node in nodes if node.get('id') == target_node_id), None)
            if not target_node:
                return []

            node_iteration_id = target_node.get('data', {}).get('iteration_id')
            # get iteration start node id
            for node in nodes:
                if node.get('id') == node_iteration_id:
                    if node.get('data', {}).get('start_node_id') == target_node_id:
                        return [target_node_id]

            return []

        start_node_ids = []
        for ingoing_edge in ingoing_edges:
            source_node_id = ingoing_edge.get('source')
            source_node = next((node for node in nodes if node.get('id') == source_node_id), None)
            if not source_node:
                continue

            node_type = source_node.get('data', {}).get('type')
            node_iteration_id = source_node.get('data', {}).get('iteration_id')
            iteration_start_node_id = None
            if node_iteration_id:
                iteration_node = next((node for node in nodes if node.get('id') == node_iteration_id), None)
                iteration_start_node_id = iteration_node.get('data', {}).get('start_node_id')

            if node_type in [
                NodeType.ANSWER.value,
                NodeType.IF_ELSE.value,
                NodeType.QUESTION_CLASSIFIER.value,
                NodeType.ITERATION.value,
                NodeType.LOOP.value
            ]:
                start_node_id = target_node_id
                start_node_ids.append(start_node_id)
            elif node_type == NodeType.START.value or \
                    node_iteration_id is not None and iteration_start_node_id == source_node.get('id'):
                start_node_id = source_node_id
                start_node_ids.append(start_node_id)
            else:
                sub_start_node_ids = self._get_answer_start_at_node_ids(graph, source_node_id)
                if sub_start_node_ids:
                    start_node_ids.extend(sub_start_node_ids)

        return start_node_ids

    def _get_iteration_nested_relations(self, graph: dict) -> dict[str, list[str]]:
        """
        Get iteration nested relations.
        :param graph: graph
        :return:
        """
        nodes = graph.get('nodes')

        iteration_ids = [node.get('id') for node in nodes
                         if node.get('data', {}).get('type') in [
                             NodeType.ITERATION.value,
                             NodeType.LOOP.value,
                         ]]

        return {
            iteration_id: [
                node.get('id') for node in nodes if node.get('data', {}).get('iteration_id') == iteration_id
            ] for iteration_id in iteration_ids
        }

    def _generate_stream_outputs_when_node_started(self) -> Generator:
        """
        Generate stream outputs.
        :return:
        """
        if self._task_state.current_stream_generate_state:
            route_chunks = self._task_state.current_stream_generate_state.generate_route[
                           self._task_state.current_stream_generate_state.current_route_position:
                           ]

            for route_chunk in route_chunks:
                if route_chunk.type == 'text':
                    route_chunk = cast(TextGenerateRouteChunk, route_chunk)

                    # handle output moderation chunk
                    should_direct_answer = self._handle_output_moderation_chunk(route_chunk.text)
                    if should_direct_answer:
                        continue

                    self._task_state.answer += route_chunk.text
                    yield self._message_to_stream_response(route_chunk.text, self._message.id)
                else:
                    break

                self._task_state.current_stream_generate_state.current_route_position += 1

            # all route chunks are generated
            if self._task_state.current_stream_generate_state.current_route_position == len(
                    self._task_state.current_stream_generate_state.generate_route
            ):
                self._task_state.current_stream_generate_state = None

    def _generate_stream_outputs_when_node_finished(self) -> Optional[Generator]:
        """
        Generate stream outputs.
        :return:
        """
        if not self._task_state.current_stream_generate_state:
            return

        route_chunks = self._task_state.current_stream_generate_state.generate_route[
                       self._task_state.current_stream_generate_state.current_route_position:]

        for route_chunk in route_chunks:
            if route_chunk.type == 'text':
                route_chunk = cast(TextGenerateRouteChunk, route_chunk)
                self._task_state.answer += route_chunk.text
                yield self._message_to_stream_response(route_chunk.text, self._message.id)
            else:
                value = None
                route_chunk = cast(VarGenerateRouteChunk, route_chunk)
                value_selector = route_chunk.value_selector
                if not value_selector:
                    self._task_state.current_stream_generate_state.current_route_position += 1
                    continue

                route_chunk_node_id = value_selector[0]

                if route_chunk_node_id == 'sys':
                    # system variable
                    value = contexts.workflow_variable_pool.get().get(value_selector)
                    if value:
                        value = value.text
                elif route_chunk_node_id in self._iteration_nested_relations:
                    # it's a iteration variable
                    if not self._iteration_state or route_chunk_node_id not in self._iteration_state.current_iterations:
                        continue
                    iteration_state = self._iteration_state.current_iterations[route_chunk_node_id]
                    iterator = iteration_state.inputs
                    if not iterator:
                        continue
                    iterator_selector = iterator.get('iterator_selector', [])
                    if value_selector[1] == 'index':
                        value = iteration_state.current_index
                    elif value_selector[1] == 'item':
                        value = iterator_selector[iteration_state.current_index] if iteration_state.current_index < len(
                            iterator_selector
                        ) else None
                else:
                    # check chunk node id is before current node id or equal to current node id
                    if route_chunk_node_id not in self._task_state.ran_node_execution_infos:
                        break

                    latest_node_execution_info = self._task_state.latest_node_execution_info

                    # get route chunk node execution info
                    route_chunk_node_execution_info = self._task_state.ran_node_execution_infos[route_chunk_node_id]
                    if (route_chunk_node_execution_info.node_type == NodeType.LLM
                            and latest_node_execution_info.node_type == NodeType.LLM):
                        # only LLM support chunk stream output
                        self._task_state.current_stream_generate_state.current_route_position += 1
                        continue

                    # get route chunk node execution
                    route_chunk_node_execution = db.session.query(WorkflowNodeExecution).filter(
                        WorkflowNodeExecution.id == route_chunk_node_execution_info.workflow_node_execution_id
                    ).first()

                    outputs = route_chunk_node_execution.outputs_dict

                    # get value from outputs
                    value = None
                    for key in value_selector[1:]:
                        if not value:
                            value = outputs.get(key) if outputs else None
                        else:
                            value = value.get(key)

                if value is not None:
                    text = ''
                    if isinstance(value, str | int | float):
                        text = str(value)
                    elif isinstance(value, FileVar):
                        # convert file to markdown
                        text = value.to_markdown()
                    elif isinstance(value, dict):
                        # handle files
                        file_vars = self._fetch_files_from_variable_value(value)
                        if file_vars:
                            file_var = file_vars[0]
                            try:
                                file_var_obj = FileVar(**file_var)

                                # convert file to markdown
                                text = file_var_obj.to_markdown()
                            except Exception as e:
                                logger.error(f'Error creating file var: {e}')

                        if not text:
                            # other types
                            text = json.dumps(value, ensure_ascii=False)
                    elif isinstance(value, list):
                        # handle files
                        file_vars = self._fetch_files_from_variable_value(value)
                        for file_var in file_vars:
                            try:
                                file_var_obj = FileVar(**file_var)
                            except Exception as e:
                                logger.error(f'Error creating file var: {e}')
                                continue

                            # convert file to markdown
                            text = file_var_obj.to_markdown() + ' '

                        text = text.strip()

                        if not text and value:
                            # other types
                            text = json.dumps(value, ensure_ascii=False)

                    if text:
                        self._task_state.answer += text
                        yield self._message_to_stream_response(text, self._message.id)

            self._task_state.current_stream_generate_state.current_route_position += 1

        # all route chunks are generated
        if self._task_state.current_stream_generate_state.current_route_position == len(
                self._task_state.current_stream_generate_state.generate_route
        ):
            self._task_state.current_stream_generate_state = None

    def _is_stream_out_support(self, event: QueueTextChunkEvent) -> bool:
        """
        Is stream out support
        :param event: queue text chunk event
        :return:
        """
        if not event.metadata:
            return True

        if 'node_id' not in event.metadata:
            return True

        node_type = event.metadata.get('node_type')
        stream_output_value_selector = event.metadata.get('value_selector')
        if not stream_output_value_selector:
            return False

        if not self._task_state.current_stream_generate_state:
            return False

        route_chunk = self._task_state.current_stream_generate_state.generate_route[
            self._task_state.current_stream_generate_state.current_route_position]

        if route_chunk.type != 'var':
            return False

        if node_type != NodeType.LLM:
            # only LLM support chunk stream output
            return False

        route_chunk = cast(VarGenerateRouteChunk, route_chunk)
        value_selector = route_chunk.value_selector

        # check chunk node id is before current node id or equal to current node id
        if value_selector != stream_output_value_selector:
            return False

        return True

    def _handle_output_moderation_chunk(self, text: str) -> bool:
        """
        Handle output moderation chunk.
        :param text: text
        :return: True if output moderation should direct output, otherwise False
        """
        if self._output_moderation_handler:
            if self._output_moderation_handler.should_direct_output():
                # stop subscribe new token when output moderation should direct output
                self._task_state.answer = self._output_moderation_handler.get_final_output()
                self._queue_manager.publish(
                    QueueTextChunkEvent(
                        text=self._task_state.answer
                    ), PublishFrom.TASK_PIPELINE
                )

                self._queue_manager.publish(
                    QueueStopEvent(stopped_by=QueueStopEvent.StopBy.OUTPUT_MODERATION),
                    PublishFrom.TASK_PIPELINE
                )
                return True
            else:
                self._output_moderation_handler.append_new_token(text)

        return False
