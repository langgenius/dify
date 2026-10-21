"""The shared handler seam preserves absence, immutable fixtures and lineage."""

import importlib

import pytest
import pytest_mock

from core.dify_builder.models import Action, Actor, Turn
from services.dify_builder.application.execution_policy import (
    BuilderExecutionPolicyError,
    HttpFixtureSetV1,
    HttpResponseFixtureV1,
)
from services.dify_builder.application.ports import DifyPort
from services.dify_builder.dify_port import WorkflowServiceDifyPort
from tests.unit_tests.installed_spies import installed_mock


def stamp(dify: DifyPort, turn: Turn) -> HttpFixtureSetV1 | None:
    return importlib.import_module("services.dify_builder.application.testdata").stamp_testdata_http_fixtures(
        dify, app_id="app", turn=turn
    )


def sample(**overrides: object) -> dict[str, object]:
    return {"node_id": "http", "status_code": 201, "content_type": "text/plain", "body": "private", **overrides}


@pytest.mark.parametrize("action", [None, Action(kind="provide_testdata", payload={"inputs": {}})])
def test_absent_http_fixtures_do_not_stamp(mocker: pytest_mock.MockerFixture, action: Action | None) -> None:
    dify = WorkflowServiceDifyPort()
    mocker.patch.object(dify, "stamp_http_fixtures")
    assert stamp(dify, Turn(actor=Actor(account_id="account", tenant_id="tenant"), action=action)) is None
    _installed_spy_1 = installed_mock(dify.stamp_http_fixtures)
    _installed_spy_1.assert_not_called()


@pytest.mark.parametrize("raw", [None, {}, [sample(source="generated_sample")], [sample(status_code=True)]])
def test_invalid_public_http_fixtures_refuse_before_stamp(mocker: pytest_mock.MockerFixture, raw: object) -> None:
    dify = WorkflowServiceDifyPort()
    mocker.patch.object(dify, "stamp_http_fixtures")
    turn = Turn(
        actor=Actor(account_id="account", tenant_id="tenant"),
        action=Action(kind="provide_testdata", payload={"http_fixtures": raw}, base_app_revision="a" * 64),
    )
    with pytest.raises(BuilderExecutionPolicyError, match="invalid_http_fixtures") as error:
        stamp(dify, turn)
    assert "private" not in str(error.value)
    _installed_spy_2 = installed_mock(dify.stamp_http_fixtures)
    _installed_spy_2.assert_not_called()


def test_shared_stamp_passes_actor_exact_base_revision_and_immutable_public_fixtures(
    mocker: pytest_mock.MockerFixture,
) -> None:
    dify = WorkflowServiceDifyPort()
    mocker.patch.object(dify, "stamp_http_fixtures")
    actor = Actor(account_id="account", tenant_id="tenant")
    revision = "a" * 64
    raw = [sample(node_id="second"), sample(node_id="first")]
    expected = tuple(HttpResponseFixtureV1.model_validate({**item, "source": "user_sample"}) for item in reversed(raw))
    envelope = HttpFixtureSetV1(execution_revision=revision, fixtures=expected)
    _installed_spy_3 = installed_mock(dify.stamp_http_fixtures)
    _installed_spy_3.return_value = envelope
    turn = Turn(
        actor=actor, action=Action(kind="provide_testdata", payload={"http_fixtures": raw}, base_app_revision=revision)
    )
    assert stamp(dify, turn) is envelope
    _installed_spy_4 = installed_mock(dify.stamp_http_fixtures)
    _installed_spy_4.assert_called_once_with("app", actor, base_app_revision=revision, fixtures=expected)
    assert "source" not in raw[0]


def test_shared_stamp_never_replaces_a_stale_submitted_base_revision(
    mocker: pytest_mock.MockerFixture,
) -> None:
    dify = WorkflowServiceDifyPort()
    mocker.patch.object(dify, "stamp_http_fixtures")
    _installed_spy_5 = installed_mock(dify.stamp_http_fixtures)
    _installed_spy_5.side_effect = BuilderExecutionPolicyError("stale_http_fixtures")
    actor = Actor(account_id="account", tenant_id="tenant")
    turn = Turn(
        actor=actor, action=Action(kind="provide_testdata", payload={"http_fixtures": []}, base_app_revision="old")
    )
    with pytest.raises(BuilderExecutionPolicyError, match="stale_http_fixtures"):
        stamp(dify, turn)
    _installed_spy_6 = installed_mock(dify.stamp_http_fixtures)
    _installed_spy_6.assert_called_once_with("app", actor, base_app_revision="old", fixtures=())
