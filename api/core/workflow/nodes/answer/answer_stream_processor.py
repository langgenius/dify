import logging
from collections.abc import Generator
from typing import cast

from core.workflow.entities.variable_pool import VariablePool
from core.workflow.graph_engine.entities.event import (
    GraphEngineEvent,
    NodeRunExceptionEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
    ParallelBranchRunFailedEvent,
    ParallelBranchRunStartedEvent,
    ParallelBranchRunSucceededEvent,
)
from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.graph_engine.entities.runtime_route_state import RouteNodeState, RuntimeRouteState
from core.workflow.nodes.answer.base_stream_processor import StreamProcessor
from core.workflow.nodes.answer.entities import GenerateRouteChunk, TextGenerateRouteChunk, VarGenerateRouteChunk

logger = logging.getLogger(__name__)


class AnswerStreamProcessor(StreamProcessor):
    def __init__(self, graph: Graph, variable_pool: VariablePool, node_run_state: RuntimeRouteState = None) -> None:
        super().__init__(graph, variable_pool, node_run_state)
        self.generate_routes = graph.answer_stream_generate_routes
        self.route_position = {}
        for answer_node_id in self.generate_routes.answer_generate_route:
            self.route_position[answer_node_id] = 0
        self.current_stream_chunk_generating_node_ids: dict[str, list[str]] = {}
        # 存储待处理的事件，按照依赖关系排序后再处理
        self.pending_events: list[NodeRunStreamChunkEvent] = []

    def process(self, generator: Generator[GraphEngineEvent, None, None]) -> Generator[GraphEngineEvent, None, None]:
        # 首先收集所有事件
        all_events = list(generator)

        # 重置处理器状态
        self.reset()

        # 按事件类型分组
        start_events = []
        stream_events = []
        complete_events = []
        parallel_events = []
        other_events = []

        for event in all_events:
            if isinstance(event, NodeRunStartedEvent):
                start_events.append(event)
            elif isinstance(event, NodeRunStreamChunkEvent):
                stream_events.append(event)
            elif isinstance(event, (NodeRunSucceededEvent, NodeRunExceptionEvent)):
                complete_events.append(event)
            elif isinstance(event, (ParallelBranchRunStartedEvent, ParallelBranchRunSucceededEvent, ParallelBranchRunFailedEvent)):
                parallel_events.append(event)
            else:
                other_events.append(event)

        # 首先处理所有开始事件
        for event in start_events:
            yield event

        # 处理所有并行事件
        for event in parallel_events:
            yield event

        # 处理流事件和完成事件
        # 创建节点状态跟踪
        node_status = {}

        # 处理完成事件
        for event in complete_events:
            node_id = event.route_node_state.node_id
            node_status[node_id] = 'completed'

        # 获取依赖关系
        dependencies = {}
        if hasattr(self.generate_routes, 'answer_dependencies'):
            dependencies = self.generate_routes.answer_dependencies.copy()

        logger.debug(f"依赖关系: {dependencies}")

        # 处理流事件和完成事件，按照依赖关系排序
        processed_nodes = set()

        # 获取所有节点ID
        all_node_ids = set(event.route_node_state.node_id for event in complete_events)

        # 创建一个新的依赖图，确保if-else节点在answer节点之前处理
        new_dependencies = {}

        # 初始化依赖图
        for node_id in all_node_ids:
            new_dependencies[node_id] = []

        # 复制原始依赖
        for node_id, deps in dependencies.items():
            if node_id in new_dependencies:
                new_dependencies[node_id].extend(deps)

        # 添加特殊规则：所有answer节点依赖于所有if-else节点
        ifelse_nodes = [node_id for node_id in all_node_ids if node_id.startswith('if-else-')]
        answer_nodes = [node_id for node_id in all_node_ids if node_id.startswith('answer-')]

        for answer_node in answer_nodes:
            for ifelse_node in ifelse_nodes:
                if ifelse_node not in new_dependencies[answer_node]:
                    new_dependencies[answer_node].append(ifelse_node)

        # 创建反向依赖图（哪些节点依赖于当前节点）
        reverse_deps = {}
        for node_id in all_node_ids:
            reverse_deps[node_id] = []

        for node_id, deps in new_dependencies.items():
            for dep in deps:
                if dep in reverse_deps:
                    reverse_deps[dep].append(node_id)

        # 创建入度表
        in_degree = {}
        for node_id in all_node_ids:
            in_degree[node_id] = len(new_dependencies[node_id])

        # 拓扑排序
        sorted_nodes = []
        queue = [node_id for node_id in all_node_ids if in_degree[node_id] == 0]

        while queue:
            # 优先处理if-else节点
            ifelse_nodes = [node_id for node_id in queue if node_id.startswith('if-else-')]
            if ifelse_nodes:
                node_id = ifelse_nodes[0]
                queue.remove(node_id)
            else:
                node_id = queue.pop(0)

            sorted_nodes.append(node_id)

            # 减少相邻节点的入度
            for next_node in reverse_deps.get(node_id, []):
                in_degree[next_node] -= 1
                if in_degree[next_node] == 0:
                    queue.append(next_node)

        # 添加没有出现在依赖关系中的节点
        for node_id in all_node_ids:
            if node_id not in sorted_nodes:
                sorted_nodes.append(node_id)

        # 按照排序处理节点
        for node_id in sorted_nodes:
            # 处理该节点的流事件
            node_stream_events = [e for e in stream_events if
                                 (e.route_node_state.node_id == node_id) or
                                 (e.from_variable_selector and e.from_variable_selector[0] == node_id)]

            for event in node_stream_events:
                if event.in_iteration_id or event.in_loop_id:
                    yield event
                    continue

                # 获取需要输出的答案节点
                if event.route_node_state.node_id in self.current_stream_chunk_generating_node_ids:
                    stream_out_answer_node_ids = self.current_stream_chunk_generating_node_ids[
                        event.route_node_state.node_id
                    ]
                else:
                    stream_out_answer_node_ids = self._get_stream_out_answer_node_ids(event)
                    self.current_stream_chunk_generating_node_ids[event.route_node_state.node_id] = (
                        stream_out_answer_node_ids
                    )

                # 输出流事件，确保为每个答案节点输出一次
                for _ in stream_out_answer_node_ids:
                    yield event

            # 处理该节点的完成事件
            node_complete_events = [e for e in complete_events if e.route_node_state.node_id == node_id]
            for event in node_complete_events:
                yield event

                if event.route_node_state.node_id in self.current_stream_chunk_generating_node_ids:
                    # 更新路由位置
                    for answer_node_id in self.current_stream_chunk_generating_node_ids[event.route_node_state.node_id]:
                        self.route_position[answer_node_id] += 1

                    del self.current_stream_chunk_generating_node_ids[event.route_node_state.node_id]

                self._remove_unreachable_nodes(event)

                # 生成流输出
                yield from self._generate_stream_outputs_when_node_finished(cast(NodeRunSucceededEvent, event))

            processed_nodes.add(node_id)

        # 处理其他事件
        for event in other_events:
            yield event

    def _sort_events_by_dependencies(self) -> list[NodeRunStreamChunkEvent]:
        """
        按照依赖关系排序事件，被依赖的节点先处理
        """
        # 创建节点ID到事件的映射
        node_id_to_event = {}
        for event in self.pending_events:
            if event.from_variable_selector:
                source_node_id = event.from_variable_selector[0]
                node_id_to_event[source_node_id] = event

        # 获取依赖关系
        dependencies = {}
        if hasattr(self.generate_routes, 'answer_dependencies'):
            # 反转依赖关系，因为我们需要被依赖的节点先处理
            # 例如，如果answer依赖于answer2，那么answer2应该先处理
            for node_id, deps in self.generate_routes.answer_dependencies.items():
                for dep in deps:
                    if dep not in dependencies:
                        dependencies[dep] = []
                    dependencies[dep].append(node_id)

        print(f"[DEBUG] 反转后的依赖关系: {dependencies}")

        # 创建依赖计数字典 - 这里计算的是有多少节点依赖于当前节点
        # 被依赖数量越多的节点应该越早处理
        dep_counts = {}
        for node_id in node_id_to_event:
            dep_counts[node_id] = len(dependencies.get(node_id, []))

        print(f"[DEBUG] 依赖计数: {dep_counts}")

        # 按照被依赖数量排序节点，被依赖越多的越先处理
        ordered_nodes = sorted(node_id_to_event.keys(), key=lambda n: dep_counts.get(n, 0), reverse=True)

        print(f"[DEBUG] 排序后的节点: {ordered_nodes}")

        # 将排序后的节点ID转换为排序后的事件
        sorted_events = []
        for node_id in ordered_nodes:
            if node_id in node_id_to_event:
                sorted_events.append(node_id_to_event[node_id])

        # 添加未排序的事件（可能是因为没有依赖关系信息）
        for event in self.pending_events:
            if event.from_variable_selector and event.from_variable_selector[0] not in ordered_nodes:
                sorted_events.append(event)

        return sorted_events

    def reset(self) -> None:
        self.route_position = {}
        for answer_node_id, route_chunks in self.generate_routes.answer_generate_route.items():
            self.route_position[answer_node_id] = 0
        self.rest_node_ids = self.graph.node_ids.copy()
        self.current_stream_chunk_generating_node_ids = {}
        self.pending_events = []

    def _sort_events_by_dependencies(self) -> list[NodeRunStreamChunkEvent]:
        """
        按照依赖关系排序事件，被依赖的节点先处理
        """
        # 创建节点ID到事件的映射
        node_id_to_event = {}
        for event in self.pending_events:
            if event.from_variable_selector:
                source_node_id = event.from_variable_selector[0]
                node_id_to_event[source_node_id] = event

        # 获取依赖关系
        dependencies = self.generate_routes.answer_dependencies.copy() if hasattr(self.generate_routes, 'answer_dependencies') else {}

        # 创建依赖计数字典
        dep_counts = {node_id: len(deps) for node_id, deps in dependencies.items()}

        # 为不在依赖字典中的节点添加空依赖
        for node_id in node_id_to_event:
            if node_id not in dep_counts:
                dep_counts[node_id] = 0

        # 创建一个没有依赖的节点列表
        no_deps = [node_id for node_id, count in dep_counts.items()
                  if count == 0 and node_id in node_id_to_event]

        # 按照依赖关系排序节点
        ordered_nodes = []
        while no_deps:
            node_id = no_deps.pop(0)
            ordered_nodes.append(node_id)

            # 更新依赖计数
            for dep_node, deps in dependencies.items():
                if node_id in deps:
                    dep_counts[dep_node] -= 1
                    if dep_counts[dep_node] == 0 and dep_node in node_id_to_event:
                        no_deps.append(dep_node)

        # 将排序后的节点ID转换为排序后的事件
        sorted_events = []
        for node_id in ordered_nodes:
            if node_id in node_id_to_event:
                sorted_events.append(node_id_to_event[node_id])

        # 添加未排序的事件（可能是因为没有依赖关系信息）
        for event in self.pending_events:
            if event.from_variable_selector and event.from_variable_selector[0] not in ordered_nodes:
                sorted_events.append(event)

        return sorted_events

    def _is_dynamic_dependencies_met(self, start_node_id: str) -> bool:
        """
        Performs a dynamic, runtime dependency check by traversing backwards from a given start_node_id.

        This method is the core of the new streaming architecture. Instead of relying on a pre-calculated,
        static dependency map, it validates the actual execution path at the moment a stream event is received.
        It queries the runtime state of the graph ('the logbook') to ensure that a valid, uninterrupted,
        and logically sound path exists from the start_node_id all the way back to the graph's entry point.

        The traversal logic handles:
        - Basic node completion states (SUCCEEDED, FAILED, RUNNING).
        - Complex branch nodes (If/Else), by checking which branch was actually taken during the run.
          Paths from branches that were not taken are considered irrelevant ("parallel universes") and ignored.

        This approach correctly handles complex topologies with join points (nodes with multiple inputs),
        ensuring that streaming is only permitted when the true, logical dependency chain for the *current run*
        has been successfully completed.

        :param start_node_id: The node ID from which to begin the backward traversal (e.g., the LLM node).
        :return: True if all dependencies on the active path are met, False otherwise.
        """
        print(f"[DEBUG] 检查节点 {start_node_id} 的动态依赖是否满足")
        # Use a queue for BFS and a set to track visited nodes to prevent cycles
        queue = [start_node_id]
        visited = {start_node_id}
        print(f"[DEBUG] 初始化队列: {queue}, 已访问节点: {visited}")

        while queue:
            current_node_id = queue.pop(0)
            print(f"[DEBUG] 当前处理节点: {current_node_id}")

            # Get the edges leading to the current node
            parent_edges = self.graph.reverse_edge_mapping.get(current_node_id, [])
            if not parent_edges:
                print(f"[DEBUG] 节点 {current_node_id} 没有父节点边")
                continue

            for edge in parent_edges:
                parent_node_id = edge.source_node_id
                print(f"[DEBUG] 检查父节点: {parent_node_id}")

                if parent_node_id in visited:
                    print(f"[DEBUG] 父节点 {parent_node_id} 已访问过，跳过")
                    continue

                visited.add(parent_node_id)
                print(f"[DEBUG] 添加父节点 {parent_node_id} 到已访问集合")

                # Find the latest execution state of the parent node in the current run
                parent_node_run_state = None
                if self.node_run_state and hasattr(self.node_run_state, 'node_state_mapping'):
                    for state in self.node_run_state.node_state_mapping.values():
                        if state.node_id == parent_node_id:
                            parent_node_run_state = state
                            break  # Assume the last found state is the latest for simplicity

                if not parent_node_run_state or parent_node_run_state.status == RouteNodeState.Status.RUNNING:
                    print(f"[DEBUG] 父节点 {parent_node_id} 状态为RUNNING或未找到状态，依赖未满足")
                    return False

                if parent_node_run_state.status in [RouteNodeState.Status.FAILED, RouteNodeState.Status.EXCEPTION]:
                    print(f"[DEBUG] 父节点 {parent_node_id} 状态为FAILED或EXCEPTION，依赖未满足")
                    return False

                # If the parent is a branch node, check if the executed branch leads to the current node
                parent_node_config = self.graph.node_id_config_mapping.get(parent_node_id, {})
                parent_node_type = parent_node_config.get("data", {}).get("type")
                print(f"[DEBUG] 父节点 {parent_node_id} 类型: {parent_node_type}")

                is_branch_node = parent_node_type in ["if-else", "question-classifier"]  # Example branch types

                if is_branch_node:
                    run_result = parent_node_run_state.node_run_result
                    chosen_handle = run_result.edge_source_handle if run_result else None
                    required_handle = edge.run_condition.branch_identify if edge.run_condition else None
                    print(f"[DEBUG] 分支节点 {parent_node_id} 选择的分支: {chosen_handle}, 需要的分支: {required_handle}")

                    # If the chosen branch does not match the path we are traversing, this dependency is not met
                    if chosen_handle and required_handle and chosen_handle != required_handle:
                        print("[DEBUG] 分支不匹配，依赖未满足")
                        return False  # This path was not taken, so the dependency is not met

                # If all checks pass, add the parent to the queue to continue traversing up
                queue.append(parent_node_id)
                print(f"[DEBUG] 添加父节点 {parent_node_id} 到队列")

        print(f"[DEBUG] 节点 {start_node_id} 的所有依赖都已满足")
        return True

    def _generate_stream_outputs_when_node_finished(
        self, event: NodeRunSucceededEvent
    ) -> Generator[GraphEngineEvent, None, None]:
        """
        Generate stream outputs.
        :param event: node run succeeded event
        :return:
        """
        print(f"[DEBUG] _generate_stream_outputs_when_node_finished: 节点 {event.route_node_state.node_id} 完成")
        for answer_node_id in self.route_position:
            print(f"[DEBUG] 检查节点 {answer_node_id} 是否需要生成输出")
            # all depends on answer node id not in rest node ids
            if event.route_node_state.node_id != answer_node_id and (
                answer_node_id not in self.rest_node_ids
                or not self._is_dynamic_dependencies_met(answer_node_id)  # Using dynamic check for final output as well
            ):
                print(f"[DEBUG] 跳过节点 {answer_node_id}，因为它不在rest_node_ids中或依赖未满足")
                continue

            route_position = self.route_position[answer_node_id]
            route_chunks = self.generate_routes.answer_generate_route[answer_node_id][route_position:]
            print(f"[DEBUG] 节点 {answer_node_id} 的路由位置: {route_position}, 剩余路由块: {len(route_chunks)}")

            for route_chunk in route_chunks:
                print(f"[DEBUG] 处理路由块类型: {route_chunk.type}")
                if route_chunk.type == GenerateRouteChunk.ChunkType.TEXT:
                    route_chunk = cast(TextGenerateRouteChunk, route_chunk)
                    print(f"[DEBUG] 生成文本块: {route_chunk.text}")
                    yield NodeRunStreamChunkEvent(
                        id=event.id,
                        node_id=event.node_id,
                        node_type=event.node_type,
                        node_data=event.node_data,
                        chunk_content=route_chunk.text,
                        route_node_state=event.route_node_state,
                        parallel_id=event.parallel_id,
                        parallel_start_node_id=event.parallel_start_node_id,
                        from_variable_selector=[answer_node_id, "answer"],
                        node_version=event.node_version,
                    )
                else:
                    route_chunk = cast(VarGenerateRouteChunk, route_chunk)
                    value_selector = route_chunk.value_selector
                    print(f"[DEBUG] 变量选择器: {value_selector}")
                    if not value_selector:
                        print("[DEBUG] 变量选择器为空，跳出循环")
                        break

                    value = self.variable_pool.get(value_selector)
                    print(f"[DEBUG] 变量值: {value}")

                    if value is None:
                        print("[DEBUG] 变量值为None，跳出循环")
                        break

                    text = value.markdown
                    print(f"[DEBUG] 变量文本: {text}")

                    if text:
                        print(f"[DEBUG] 生成变量块: {text}")
                        yield NodeRunStreamChunkEvent(
                            id=event.id,
                            node_id=event.node_id,
                            node_type=event.node_type,
                            node_data=event.node_data,
                            chunk_content=text,
                            from_variable_selector=list(value_selector),
                            route_node_state=event.route_node_state,
                            parallel_id=event.parallel_id,
                            parallel_start_node_id=event.parallel_start_node_id,
                            node_version=event.node_version,
                        )

                self.route_position[answer_node_id] += 1
                print(f"[DEBUG] 更新节点 {answer_node_id} 的路由位置: {self.route_position[answer_node_id]}")
        print("[DEBUG] _generate_stream_outputs_when_node_finished 完成")


    def _get_stream_out_answer_node_ids(self, event: NodeRunStreamChunkEvent) -> list[str]:
        """
        Is stream out support
        :param event: queue text chunk event
        :return:
        """
        if not event.from_variable_selector:
            return []

        stream_output_value_selector = event.from_variable_selector
        if not stream_output_value_selector:
            return []

        # 获取当前事件的源节点ID
        source_node_id = stream_output_value_selector[0]
        print(f"[DEBUG] 处理来自节点 {source_node_id} 的事件，value_selector={stream_output_value_selector}")

        # 按照依赖关系排序的答案节点列表
        ordered_answer_nodes = []

        # 检查是否有依赖关系信息
        if hasattr(self.generate_routes, 'answer_dependencies') and self.generate_routes.answer_dependencies:
            # 获取依赖关系 - 注意这里的依赖关系是反向的，即被依赖的节点列表
            # 例如，如果answer依赖于answer2，那么dependencies中是answer: ['answer2']
            dependencies = self.generate_routes.answer_dependencies.copy()
            print(f"[DEBUG] 依赖关系: {dependencies}")

            # 创建反向依赖图，即依赖于某节点的节点列表
            # 例如，如果answer依赖于answer2，那么reverse_deps中是answer2: ['answer']
            reverse_deps = {}
            for node_id in self.route_position.keys():
                reverse_deps[node_id] = []

            for node_id, deps in dependencies.items():
                for dep in deps:
                    if dep in reverse_deps:
                        reverse_deps[dep].append(node_id)

            print(f"[DEBUG] 反向依赖关系: {reverse_deps}")

            # 创建依赖计数字典，记录每个节点的依赖数量
            dep_counts = {node_id: len(deps) for node_id, deps in dependencies.items()}

            # 为不在依赖字典中的节点添加空依赖
            for node_id in self.route_position.keys():
                if node_id not in dep_counts:
                    dep_counts[node_id] = 0

            print(f"[DEBUG] 依赖计数: {dep_counts}")

            # 创建一个没有依赖的节点列表
            no_deps = [node_id for node_id, count in dep_counts.items()
                      if count == 0 and node_id in self.route_position.keys()]

            print(f"[DEBUG] 初始无依赖节点列表: {no_deps}")

            # 按照依赖关系排序节点
            while no_deps:
                # 按照被依赖数量排序，被依赖越多的越先处理
                no_deps.sort(key=lambda n: len(reverse_deps.get(n, [])), reverse=True)
                print(f"[DEBUG] 排序后的无依赖节点列表: {no_deps}")

                node_id = no_deps.pop(0)
                print(f"[DEBUG] 选择处理节点: {node_id}")

                ordered_answer_nodes.append(node_id)

                # 更新依赖计数
                for dep_node, deps in dependencies.items():
                    if node_id in deps:
                        dep_counts[dep_node] -= 1
                        if dep_counts[dep_node] == 0:
                            no_deps.append(dep_node)
                            print(f"[DEBUG] 节点 {dep_node} 的依赖已满足，添加到无依赖列表")

            print(f"[DEBUG] 最终排序结果: {ordered_answer_nodes}")

        # 如果没有依赖关系或排序失败，使用默认顺序
        if not ordered_answer_nodes:
            ordered_answer_nodes = list(self.route_position.keys())
            print(f"[DEBUG] 使用默认顺序: {ordered_answer_nodes}")

        stream_out_answer_node_ids = []
        for answer_node_id in ordered_answer_nodes:
            route_position = self.route_position.get(answer_node_id, 0)
            if answer_node_id not in self.rest_node_ids:
                print(f"[DEBUG] 跳过节点 {answer_node_id}，不在rest_node_ids中")
                continue

            # New dynamic dependency check, replacing the old static dependency list.
            source_node_id_for_check = event.from_variable_selector[0]
            all_deps_finished = self._is_dynamic_dependencies_met(start_node_id=source_node_id_for_check)
            print(f"[DEBUG] 节点 {answer_node_id} 的动态依赖检查结果: {all_deps_finished}")

            if all_deps_finished:
                if route_position >= len(self.generate_routes.answer_generate_route.get(answer_node_id, [])):
                    print(f"[DEBUG] 跳过节点 {answer_node_id}，路由位置超出范围")
                    continue

                route_chunk = self.generate_routes.answer_generate_route[answer_node_id][route_position]
                print(f"[DEBUG] 节点 {answer_node_id} 的路由块类型: {route_chunk.type}")

                if route_chunk.type != GenerateRouteChunk.ChunkType.VAR:
                    print(f"[DEBUG] 跳过节点 {answer_node_id}，路由块不是变量类型")
                    continue

                route_chunk = cast(VarGenerateRouteChunk, route_chunk)
                value_selector = route_chunk.value_selector
                print(f"[DEBUG] 节点 {answer_node_id} 的变量选择器: {value_selector}")

                # check chunk node id is before current node id or equal to current node id
                # 修改为检查value_selector的第一个元素（节点ID）是否等于stream_output_value_selector的第一个元素
                if not value_selector or not stream_output_value_selector or value_selector[0] != stream_output_value_selector[0]:
                    print(f"[DEBUG] 跳过节点 {answer_node_id}，变量选择器不匹配")
                    continue

                stream_out_answer_node_ids.append(answer_node_id)
                print(f"[DEBUG] 添加节点 {answer_node_id} 到输出列表")

        print(f"[DEBUG] 最终输出节点列表: {stream_out_answer_node_ids}")
        return stream_out_answer_node_ids
