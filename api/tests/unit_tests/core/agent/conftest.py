from collections.abc import Callable
from dataclasses import dataclass

import pytest


@dataclass
class DummyTool:
    name: str


@dataclass
class DummyPromptEntity:
    first_prompt: str


@dataclass
class DummyAgentConfig:
    prompt_entity: DummyPromptEntity | None = None

    @property
    def prompt(self) -> DummyPromptEntity | None:
        return self.prompt_entity


@dataclass
class DummyAppConfig:
    agent: DummyAgentConfig | None = None


@dataclass
class DummyScratchpadUnit:
    final: bool = False
    thought: str | None = None
    action_str: str | None = None
    observation: str | None = None
    agent_response: str | None = None

    def is_final(self) -> bool:
        return self.final


@pytest.fixture
def dummy_tool_factory() -> Callable[[str], DummyTool]:
    def _factory(name: str) -> DummyTool:
        return DummyTool(name)

    return _factory


@pytest.fixture
def dummy_prompt_entity_factory() -> Callable[[str], DummyPromptEntity]:
    def _factory(first_prompt: str) -> DummyPromptEntity:
        return DummyPromptEntity(first_prompt)

    return _factory


@pytest.fixture
def dummy_agent_config_factory() -> Callable[..., DummyAgentConfig]:
    def _factory(prompt_entity: DummyPromptEntity | None = None) -> DummyAgentConfig:
        return DummyAgentConfig(prompt_entity)

    return _factory


@pytest.fixture
def dummy_app_config_factory() -> Callable[..., DummyAppConfig]:
    def _factory(agent: DummyAgentConfig | None = None) -> DummyAppConfig:
        return DummyAppConfig(agent)

    return _factory


@pytest.fixture
def dummy_scratchpad_unit_factory() -> Callable[..., DummyScratchpadUnit]:
    def _factory(
        *,
        final: bool = False,
        thought: str | None = None,
        action_str: str | None = None,
        observation: str | None = None,
        agent_response: str | None = None,
    ) -> DummyScratchpadUnit:
        return DummyScratchpadUnit(
            final=final,
            thought=thought,
            action_str=action_str,
            observation=observation,
            agent_response=agent_response,
        )

    return _factory
