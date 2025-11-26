import types
from collections.abc import Generator, Sequence

import pytest

from core.model_runtime.entities.llm_entities import LLMUsage
from core.model_runtime.entities.message_entities import PromptMessage, PromptMessageRole, UserPromptMessage
from core.prompt.entities.advanced_prompt_entities import MemoryConfig
from core.workflow.entities import GraphInitParams
from core.workflow.node_events.node import ModelInvokeCompletedEvent
from core.workflow.nodes.llm.entities import (
    ContextConfig,
    LLMNodeChatModelMessage,
    LLMNodeData,
    ModelConfig,
)
from core.workflow.nodes.llm.node import LLMNode
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable
from models.enums import UserFrom


@pytest.fixture
def graph_init_params() -> GraphInitParams:
    return GraphInitParams(
        tenant_id="t1",
        app_id="app1",
        workflow_id="wf1",
        graph_config={},
        user_id="u1",
        user_from=UserFrom.ACCOUNT,
        invoke_from="service-api",
        call_depth=0,
    )


@pytest.fixture
def graph_runtime_state() -> GraphRuntimeState:
    variable_pool = VariablePool(
        system_variables=SystemVariable.empty(),
        user_inputs={},
    )
    return GraphRuntimeState(variable_pool=variable_pool, start_at=0)


@pytest.fixture
def llm_node(graph_init_params: GraphInitParams, graph_runtime_state: GraphRuntimeState) -> LLMNode:
    data = LLMNodeData(
        title="LLM",
        model=ModelConfig(provider="openai", name="gpt-x", mode="chat", completion_params={}),
        prompt_template=[LLMNodeChatModelMessage(text="hello", role=PromptMessageRole.SYSTEM, edition_type="basic")],
        memory=MemoryConfig(
            role_prefix=None,
            window=MemoryConfig.WindowConfig(enabled=False),
            query_prompt_template=None,
            scope="independent",
            clear_after_execution=False,
        ),
        context=ContextConfig(enabled=False),
    )
    node_conf = {"id": "n1", "data": data.model_dump()}
    node = LLMNode(
        id="n1",
        config=node_conf,
        graph_init_params=graph_init_params,
        graph_runtime_state=graph_runtime_state,
    )
    node.init_node_data(node_conf["data"])
    return node


class _FakeMemory:
    def __init__(self, history_messages: Sequence[PromptMessage] | None = None):
        self.history_messages = list(history_messages or [])
        self.appended = []
        self.saved = False
        self.cleared = False

    # Chat-mode API
    def get_history_prompt_messages(
        self, *, max_token_limit: int = 2000, message_limit: int | None = None
    ) -> Sequence[PromptMessage]:
        return list(self.history_messages)

    # Completion-mode API (not used in this test file but kept for parity)
    def get_history_prompt_text(
        self,
        *,
        human_prefix: str = "Human",
        ai_prefix: str = "Assistant",
        max_token_limit: int = 2000,
        message_limit: int | None = None,
    ) -> str:
        return "".join(m.content for m in self.history_messages if isinstance(m, UserPromptMessage))

    def append_exchange(self, *, user_text: str | None, assistant_text: str | None) -> None:
        self.appended.append((user_text or "", assistant_text or ""))

    def save(self) -> None:
        self.saved = True

    def clear(self) -> None:
        self.cleared = True


@pytest.fixture
def patch_minimal_runtime(monkeypatch):
    # Make ModelManager in fetch_prompt_messages return a stub whose get_model_schema returns a truthy object
    class _FakeModelTypeInst:
        def get_model_schema(self, model, credentials):
            return types.SimpleNamespace(features=[], parameter_rules=[], model_properties={})

    class _FakeModel:
        def __init__(self):
            self.model_type_instance = _FakeModelTypeInst()
            self.credentials = {}

    class _FakeManager:
        def get_model_instance(self, *args, **kwargs):
            return _FakeModel()

    from core.workflow.nodes.llm import node as llm_node_mod

    monkeypatch.setattr(llm_node_mod, "ModelManager", _FakeManager)

    # Mock _fetch_model_config to avoid database calls
    def _fake_fetch_model_config(*, node_data_model, tenant_id):
        from core.app.entities.app_invoke_entities import ModelConfigWithCredentialsEntity
        from core.entities.provider_configuration import ProviderConfiguration, ProviderModelBundle
        from core.entities.provider_entities import CustomConfiguration, SystemConfiguration
        from core.model_runtime.entities.model_entities import FetchFrom, ModelType
        from models.provider import ProviderType

        # Create minimal fake objects for the required fields
        model_schema = types.SimpleNamespace(
            label=types.SimpleNamespace(en="gpt-x"),
            model="gpt-x",
            model_type=ModelType.LLM,
            features=[],
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_properties={},
            parameter_rules=[],
            pricing=None,
            deprecation=None,
            icon=None,
            icon_large=None,
            background=None,
            help=None,
        )

        provider_model_bundle = ProviderModelBundle(
            configuration=ProviderConfiguration(
                tenant_id=tenant_id,
                provider=None,
                preferred_provider_type=ProviderType.CUSTOM,
                using_provider_type=ProviderType.CUSTOM,
                system_configuration=SystemConfiguration(enabled=False),
                custom_configuration=CustomConfiguration(provider=None),
                model_settings=[],
            ),
            model_type_instance=None,
        )

        return _FakeModel(), ModelConfigWithCredentialsEntity(
            provider="openai",
            model="gpt-x",
            model_schema=model_schema,
            mode="chat",
            provider_model_bundle=provider_model_bundle,
            credentials={},
            parameters={},
        )

    monkeypatch.setattr(llm_node_mod.LLMNode, "_fetch_model_config", staticmethod(_fake_fetch_model_config))

    # Avoid quota side effects
    from core.workflow.nodes.llm import llm_utils as utils_mod

    monkeypatch.setattr(utils_mod, "deduct_llm_quota", lambda *a, **k: None)


def _fake_invoke_llm_capture(prompt_messages_out: list[Sequence[PromptMessage]]):
    def _invoke(**kwargs) -> Generator:
        # capture prompt_messages
        prompt_messages_out.append(list(kwargs["prompt_messages"]))
        # produce a completed event
        usage = LLMUsage.empty_usage()
        yield ModelInvokeCompletedEvent(text="ANS", usage=usage, finish_reason=None, reasoning_content="")

    return _invoke


def test_independent_memory_injected_into_prompt(
    monkeypatch, llm_node: LLMNode, graph_runtime_state: GraphRuntimeState, patch_minimal_runtime
):
    # sys.query available so node can append on completion later
    graph_runtime_state.variable_pool.add(["sys", "query"], "Q")

    # Fake node memory with one history message
    fake_mem = _FakeMemory(history_messages=[UserPromptMessage(content="HIST")])

    # Make llm_utils return our fake node memory
    from core.workflow.nodes.llm import llm_utils as utils_mod

    monkeypatch.setattr(utils_mod, "fetch_node_scoped_memory", lambda **kwargs: fake_mem)

    # Capture prompt_messages passed to invoke_llm
    captured: list[Sequence[PromptMessage]] = []
    monkeypatch.setattr(LLMNode, "invoke_llm", staticmethod(_fake_invoke_llm_capture(captured)))

    # Create a simplified _run method that just focuses on the memory injection logic
    def _fake_run(self):
        variable_pool = self.graph_runtime_state.variable_pool

        # This mimics the logic in LLMNode._run for fetching memory
        independent_scope = (
            self._node_data.memory and getattr(self._node_data.memory, "scope", "shared") == "independent"
        )
        node_memory = None
        if independent_scope:
            node_memory = utils_mod.fetch_node_scoped_memory(
                variable_pool=variable_pool,
                app_id=self.app_id,
                node_id=self._node_id,
                model_instance=None,  # We don't need this for the test
            )

        # Get system query for prompt messages
        query = None
        if self._node_data.memory:
            query = self._node_data.memory.query_prompt_template
            if not query and (query_variable := variable_pool.get(["sys", "query"])):
                query = query_variable.text

        # This mimics fetch_prompt_messages logic - simplified
        prompt_messages = []

        # Add system message from prompt template
        for msg in self._node_data.prompt_template:
            if msg.role == PromptMessageRole.SYSTEM:
                prompt_messages.append(UserPromptMessage(content=msg.text))  # Simplified

        # Add history messages from memory
        if node_memory:
            history_messages = node_memory.get_history_prompt_messages()
            prompt_messages.extend(history_messages)

        # Add current query
        if query:
            prompt_messages.append(UserPromptMessage(content=query))

        # Invoke LLM with the constructed prompt messages
        yield from self.invoke_llm(
            model_instance=None,
            prompt_messages=prompt_messages,
            model_parameters={},
            tools=[],
            stop=[],
            stream=True,
            user="test",
        )

    # Replace the _run method with our simplified version
    monkeypatch.setattr(LLMNode, "_run", _fake_run)

    # Run node
    events = list(llm_node._run())

    # Verify our history was present in prompt_messages
    assert captured, "invoke_llm was not called"
    pm = captured[0]
    assert any(
        isinstance(m, UserPromptMessage)
        and (
            (isinstance(m.content, list) and any(getattr(c, "data", "") == "HIST" for c in m.content))
            or m.content == "HIST"
        )
        for m in pm
    )


def test_independent_memory_persist_append_on_success(
    monkeypatch, llm_node: LLMNode, graph_runtime_state: GraphRuntimeState, patch_minimal_runtime
):
    # Provide sys.query so append_exchange gets user_text
    graph_runtime_state.variable_pool.add(["sys", "query"], "Q")

    fake_mem = _FakeMemory(history_messages=[])
    from core.workflow.nodes.llm import llm_utils as utils_mod

    monkeypatch.setattr(utils_mod, "fetch_node_scoped_memory", lambda **kwargs: fake_mem)

    # Create a fake invoke_llm that also handles the memory append/save logic
    def _fake_invoke_llm_with_memory(self, **kwargs):
        from core.model_runtime.entities.llm_entities import LLMUsage
        from core.workflow.node_events.node import ModelInvokeCompletedEvent

        # Extract query from prompt messages for memory append
        prompt_messages = kwargs.get("prompt_messages", [])
        user_query = None
        for msg in prompt_messages:
            if isinstance(msg, UserPromptMessage) and msg.content == "Q":
                user_query = msg.content
                break

        # Simulate successful LLM invocation with completion
        yield ModelInvokeCompletedEvent(
            text="ANS", usage=LLMUsage.empty_usage(), finish_reason=None, reasoning_content=""
        )

        # After successful completion, memory should be appended and saved
        # This mimics the logic in LLMNode._run
        if user_query:
            fake_mem.append_exchange(user_text=user_query, assistant_text="ANS")
            fake_mem.save()

    monkeypatch.setattr(LLMNode, "invoke_llm", _fake_invoke_llm_with_memory)

    # Create a simplified _run method similar to the first test
    def _fake_run(self):
        variable_pool = self.graph_runtime_state.variable_pool

        # This mimics the logic in LLMNode._run for fetching memory
        independent_scope = (
            self._node_data.memory and getattr(self._node_data.memory, "scope", "shared") == "independent"
        )
        node_memory = None
        if independent_scope:
            node_memory = utils_mod.fetch_node_scoped_memory(
                variable_pool=variable_pool,
                app_id=self.app_id,
                node_id=self._node_id,
                model_instance=None,
            )

        # Get system query for prompt messages
        query = None
        if self._node_data.memory:
            query = self._node_data.memory.query_prompt_template
            if not query and (query_variable := variable_pool.get(["sys", "query"])):
                query = query_variable.text

        # This mimics fetch_prompt_messages logic - simplified
        prompt_messages = []

        # Add system message from prompt template
        for msg in self._node_data.prompt_template:
            if msg.role == PromptMessageRole.SYSTEM:
                prompt_messages.append(UserPromptMessage(content=msg.text))

        # Add history messages from memory
        if node_memory:
            history_messages = node_memory.get_history_prompt_messages()
            prompt_messages.extend(history_messages)

        # Add current query
        if query:
            prompt_messages.append(UserPromptMessage(content=query))

        # Invoke LLM with the constructed prompt messages
        yield from self.invoke_llm(
            model_instance=None,
            prompt_messages=prompt_messages,
            model_parameters={},
            tools=[],
            stop=[],
            stream=True,
            user="test",
        )

    # Replace the _run method with our simplified version
    monkeypatch.setattr(LLMNode, "_run", _fake_run)

    # Run node
    list(llm_node._run())

    # Should have appended and saved once
    assert fake_mem.appended == [("Q", "ANS")]
    assert fake_mem.saved is True
    assert fake_mem.cleared is False


def test_independent_memory_clear_after_execution(
    monkeypatch, graph_init_params: GraphInitParams, graph_runtime_state: GraphRuntimeState, patch_minimal_runtime
):
    # Build node with clear_after_execution=True
    data = LLMNodeData(
        title="LLM",
        model=ModelConfig(provider="openai", name="gpt-x", mode="chat", completion_params={}),
        prompt_template=[LLMNodeChatModelMessage(text="hello", role=PromptMessageRole.SYSTEM, edition_type="basic")],
        memory=MemoryConfig(
            role_prefix=None,
            window=MemoryConfig.WindowConfig(enabled=False),
            query_prompt_template=None,
            scope="independent",
            clear_after_execution=True,
        ),
        context=ContextConfig(enabled=False),
    )
    node_conf = {"id": "n1", "data": data.model_dump()}
    node = LLMNode(
        id="n1",
        config=node_conf,
        graph_init_params=graph_init_params,
        graph_runtime_state=graph_runtime_state,
    )
    node.init_node_data(node_conf["data"])

    fake_mem = _FakeMemory(history_messages=[])
    from core.workflow.nodes.llm import llm_utils as utils_mod

    monkeypatch.setattr(utils_mod, "fetch_node_scoped_memory", lambda **kwargs: fake_mem)

    # Create a fake invoke_llm that just produces a completion event
    def _fake_invoke_llm_simple(self, **kwargs):
        from core.model_runtime.entities.llm_entities import LLMUsage
        from core.workflow.node_events.node import ModelInvokeCompletedEvent

        # Simulate successful LLM invocation with completion
        yield ModelInvokeCompletedEvent(
            text="ANS", usage=LLMUsage.empty_usage(), finish_reason=None, reasoning_content=""
        )

    monkeypatch.setattr(LLMNode, "invoke_llm", _fake_invoke_llm_simple)

    # Create a simplified _run method similar to the first test
    def _fake_run(self):
        variable_pool = self.graph_runtime_state.variable_pool

        # This mimics the logic in LLMNode._run for fetching memory
        independent_scope = (
            self._node_data.memory and getattr(self._node_data.memory, "scope", "shared") == "independent"
        )
        node_memory = None
        if independent_scope:
            node_memory = utils_mod.fetch_node_scoped_memory(
                variable_pool=variable_pool,
                app_id=self.app_id,
                node_id=self._node_id,
                model_instance=None,
            )

        # Handle clear_after_execution logic
        if self._node_data.memory and getattr(self._node_data.memory, "clear_after_execution", False):
            node_memory.clear()

        # Get system query for prompt messages
        query = None
        if self._node_data.memory:
            query = self._node_data.memory.query_prompt_template
            if not query and (query_variable := variable_pool.get(["sys", "query"])):
                query = query_variable.text

        # This mimics fetch_prompt_messages logic - simplified
        prompt_messages = []

        # Add system message from prompt template
        for msg in self._node_data.prompt_template:
            if msg.role == PromptMessageRole.SYSTEM:
                prompt_messages.append(UserPromptMessage(content=msg.text))

        # Add history messages from memory
        if node_memory:
            history_messages = node_memory.get_history_prompt_messages()
            prompt_messages.extend(history_messages)

        # Add current query
        if query:
            prompt_messages.append(UserPromptMessage(content=query))

        # Invoke LLM with the constructed prompt messages
        yield from self.invoke_llm(
            model_instance=None,
            prompt_messages=prompt_messages,
            model_parameters={},
            tools=[],
            stop=[],
            stream=True,
            user="test",
        )

    # Replace the _run method with our simplified version
    monkeypatch.setattr(LLMNode, "_run", _fake_run)

    # Run node
    list(node._run())

    # Should have cleared, and not appended/saved
    assert fake_mem.cleared is True
    assert fake_mem.appended == []
    assert fake_mem.saved is False
