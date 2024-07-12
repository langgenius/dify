import logging
import queue
import time
from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional, cast

from flask import Flask, current_app

from core.app.apps.base_app_queue_manager import GenerateTaskStoppedException
from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.callbacks.base_workflow_callback import BaseWorkflowCallback
from core.workflow.entities.node_entities import NodeType
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.graph_engine.condition_handlers.condition_manager import ConditionManager
from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.graph_engine.entities.graph_runtime_state import GraphRuntimeState
from core.workflow.nodes.base_node import UserFrom
from extensions.ext_database import db

thread_pool = ThreadPoolExecutor(max_workers=500, thread_name_prefix="ThreadGraphParallelRun")
logger = logging.getLogger(__name__)


class GraphEngine:
    def __init__(self, tenant_id: str,
                 app_id: str,
                 user_id: str,
                 user_from: UserFrom,
                 invoke_from: InvokeFrom,
                 call_depth: int,
                 graph: Graph,
                 variable_pool: VariablePool,
                 callbacks: list[BaseWorkflowCallback]) -> None:
        self.graph = graph
        self.graph_runtime_state = GraphRuntimeState(
            tenant_id=tenant_id,
            app_id=app_id,
            user_id=user_id,
            user_from=user_from,
            invoke_from=invoke_from,
            call_depth=call_depth,
            variable_pool=variable_pool,
            start_at=time.perf_counter()
        )

        max_execution_steps = current_app.config.get("WORKFLOW_MAX_EXECUTION_STEPS")
        self.max_execution_steps = cast(int, max_execution_steps)
        max_execution_time = current_app.config.get("WORKFLOW_MAX_EXECUTION_TIME")
        self.max_execution_time = cast(int, max_execution_time)

        self.callbacks = callbacks

    def run_in_block_mode(self):
        # TODO convert generator to result
        pass

    def run(self) -> Generator:
        # TODO trigger graph run start event

        try:
            # TODO run graph
            rst = self._run(start_node_id=self.graph.root_node_id)
        except GraphRunFailedError as e:
            # TODO self._graph_run_failed(
            #     error=e.error,
            #     callbacks=callbacks
            # )
            pass
        except Exception as e:
            # TODO self._workflow_run_failed(
            #     error=str(e),
            #     callbacks=callbacks
            # )
            pass

        # TODO trigger graph run success event

        yield rst

    def _run(self, start_node_id: str, in_parallel_id: Optional[str] = None):
        next_node_id = start_node_id
        while True:
            # max steps reached
            if self.graph_runtime_state.node_run_steps > self.max_execution_steps:
                raise GraphRunFailedError('Max steps {} reached.'.format(self.max_execution_steps))

            # or max execution time reached
            if self._is_timed_out(
                start_at=self.graph_runtime_state.start_at,
                max_execution_time=self.max_execution_time
            ):
                raise GraphRunFailedError('Max execution time {}s reached.'.format(self.max_execution_time))

            # run node TODO generator
            yield from self._run_node(node_id=next_node_id)

            # todo if failed, break

            # get next node ids
            edge_mappings = self.graph.edge_mapping.get(next_node_id)
            if not edge_mappings:
                break

            if len(edge_mappings) == 1:
                next_node_id = edge_mappings[0].target_node_id

                # It may not be necessary, but it is necessary. :)
                if (self.graph.node_id_config_mapping[next_node_id]
                        .get("data", {}).get("type", "").lower() == NodeType.END.value):
                    break
            else:
                if any(edge.run_condition for edge in edge_mappings):
                    # if nodes has run conditions, get node id which branch to take based on the run condition results
                    final_node_id = None
                    for edge in edge_mappings:
                        if edge.run_condition:
                            result = ConditionManager.get_condition_handler(
                                run_condition=edge.run_condition
                            ).check(
                                source_node_id=edge.source_node_id,
                                target_node_id=edge.target_node_id,
                                graph=self.graph
                            )

                            if result:
                                final_node_id = edge.target_node_id
                                break

                    if not final_node_id:
                        break

                    next_node_id = final_node_id
                else:
                    # if nodes has no run conditions, parallel run all nodes
                    parallel_id = self.graph.node_parallel_mapping.get(edge_mappings[0].source_node_id)
                    if not parallel_id:
                        raise GraphRunFailedError('Node related parallel not found.')

                    parallel = self.graph.parallel_mapping.get(parallel_id)
                    if not parallel:
                        raise GraphRunFailedError('Parallel not found.')

                    # run parallel nodes, run in new thread and use queue to get results
                    q: queue.Queue = queue.Queue()

                    # new thread
                    futures = []
                    for edge in edge_mappings:
                        futures.append(thread_pool.submit(
                            self._run_parallel_node,
                            flask_app=current_app._get_current_object(),
                            parallel_start_node_id=edge.source_node_id,
                            q=q
                        ))

                    while True:
                        try:
                            event = q.get(timeout=1)
                            if event is None:
                                break

                            # TODO tag event with parallel id
                            yield event
                        except queue.Empty:
                            continue

                    for future in as_completed(futures):
                        future.result()

                    # get final node id
                    final_node_id = parallel.end_to_node_id
                    if not final_node_id:
                        break

                    next_node_id = final_node_id

            if in_parallel_id and self.graph.node_parallel_mapping.get(next_node_id, '') == in_parallel_id:
                break

    def _run_parallel_node(self, flask_app: Flask, parallel_start_node_id: str, q: queue.Queue) -> None:
        """
        Run parallel nodes
        """
        with flask_app.app_context():
            try:
                in_parallel_id = self.graph.node_parallel_mapping.get(parallel_start_node_id)
                if not in_parallel_id:
                    q.put(None)
                    return

                # run node TODO generator
                rst = self._run(
                    start_node_id=parallel_start_node_id,
                    in_parallel_id=in_parallel_id
                )

                if not rst:
                    q.put(None)
                    return

                for item in rst:
                    q.put(item)

                q.put(None)
            except Exception:
                logger.exception("Unknown Error when generating in parallel")
            finally:
                db.session.remove()

    def _run_node(self, node_id: str) -> Generator:
        """
        Run node
        """
        # get node config
        node_config = self.graph.node_id_config_mapping.get(node_id)
        if not node_config:
            raise GraphRunFailedError('Node not found.')

        # todo convert to specific node

        # todo trigger node run start event

        db.session.close()

        # TODO reference from core.workflow.workflow_entry.WorkflowEntry._run_workflow_node

        self.graph_runtime_state.node_run_steps += 1

        try:
            # run node
            rst = node.run(
                graph_runtime_state=self.graph_runtime_state,
                graph=self.graph,
                callbacks=self.callbacks
            )

            yield from rst

            # todo record state
        except GenerateTaskStoppedException as e:
            # TODO yield failed
            # todo trigger node run failed event
            pass
        except Exception as e:
            # logger.exception(f"Node {node.node_data.title} run failed: {str(e)}")
            # TODO yield failed
            # todo trigger node run failed event
            pass

        # todo trigger node run success event

        db.session.close()

    def _is_timed_out(self, start_at: float, max_execution_time: int) -> bool:
        """
        Check timeout
        :param start_at: start time
        :param max_execution_time: max execution time
        :return:
        """
        return time.perf_counter() - start_at > max_execution_time


class GraphRunFailedError(Exception):
    def __init__(self, error: str):
        self.error = error
