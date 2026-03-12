import pytest


class DummyTool:
    def __init__(self, name):
        self.name = name


class DummyPromptEntity:
    def __init__(self, first_prompt):
        self.first_prompt = first_prompt


class DummyAgentConfig:
    def __init__(self, prompt_entity=None):
        self.prompt = prompt_entity


class DummyAppConfig:
    def __init__(self, agent=None):
        self.agent = agent


class DummyScratchpadUnit:
    def __init__(
        self,
        final=False,
        thought=None,
        action_str=None,
        observation=None,
        agent_response=None,
    ):
        self._final = final
        self.thought = thought
        self.action_str = action_str
        self.observation = observation
        self.agent_response = agent_response

    def is_final(self):
        return self._final


@pytest.fixture
def dummy_tool_factory():
    def _factory(name):
        return DummyTool(name)

    return _factory


@pytest.fixture
def dummy_prompt_entity_factory():
    def _factory(first_prompt):
        return DummyPromptEntity(first_prompt)

    return _factory


@pytest.fixture
def dummy_agent_config_factory():
    def _factory(prompt_entity=None):
        return DummyAgentConfig(prompt_entity)

    return _factory


@pytest.fixture
def dummy_app_config_factory():
    def _factory(agent=None):
        return DummyAppConfig(agent)

    return _factory


@pytest.fixture
def dummy_scratchpad_unit_factory():
    def _factory(**kwargs):
        return DummyScratchpadUnit(**kwargs)

    return _factory
