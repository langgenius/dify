"""Fixtures scoped to Human Input core tests."""

from collections.abc import Iterator

import pytest

from tests.helpers.unit.core.human_input_v2.slack import SlackApiServer, run_slack_api_server


@pytest.fixture
def slack_api_server() -> Iterator[SlackApiServer]:
    """Run an isolated local Slack HTTP server for the requesting test."""
    with run_slack_api_server() as server:
        yield server
