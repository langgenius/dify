import uuid
from collections.abc import Callable, Mapping
from typing import Protocol, cast, runtime_checkable

import pytest
from flask import Flask
from sqlalchemy.orm import Session, sessionmaker

from constants.oauth_bearer import TokenType
from controllers.openapi import node_types
from controllers.openapi._errors import NodeTypeNotFound
from controllers.openapi._models import NodeTypeDetailResponse, NodeTypeListResponse
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.subjects import AccountSubject
from graphon.enums import BuiltinNodeTypes
from graphon.nodes.code import CodeNode
from graphon.nodes.http_request import HttpRequestNode
from libs.oauth_bearer import AuthContext
from services.workflow_service import WorkflowService


@runtime_checkable
class _EndpointView(Protocol):
    __handler__: Callable[..., object]


@pytest.fixture
def describe(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> Callable[[str], NodeTypeDetailResponse]:
    # `WorkflowService()` builds its sessions from db.engine, which the bare Flask app does not have
    monkeypatch.setattr(node_types, "WorkflowService", lambda: WorkflowService(sqlite_session_factory))
    auth = AuthContext(
        token_type=TokenType.OAUTH_ACCOUNT,
        subject_email="caller@example.com",
        subject_issuer="dify:account",
        account_id=uuid.uuid4(),
        client_id="difyctl",
        token_id=uuid.uuid4(),
        expires_at=None,
    )

    def run(node_type: str) -> NodeTypeDetailResponse:
        ctx = Context(AccountSubject(auth), sqlite_session, {"node_type": node_type})
        api = node_types.NodeTypeDetailApi()
        with app.test_request_context(f"/openapi/v1/node-types/{node_type}"):
            return cast(NodeTypeDetailResponse, cast(_EndpointView, api.get).__handler__(api, ctx, node_type))

    return run


@pytest.fixture
def list_types(app: Flask, sqlite_session: Session) -> Callable[[], list[str]]:
    auth = AuthContext(
        token_type=TokenType.OAUTH_ACCOUNT,
        subject_email="caller@example.com",
        subject_issuer="dify:account",
        account_id=uuid.uuid4(),
        client_id="difyctl",
        token_id=uuid.uuid4(),
        expires_at=None,
    )

    def run() -> list[str]:
        ctx = Context(AccountSubject(auth), sqlite_session, {})
        api = node_types.NodeTypeListApi()
        view = node_types.NodeTypeListApi.get
        assert isinstance(view, _EndpointView)
        with app.test_request_context("/openapi/v1/node-types"):
            response = view.__handler__(api, ctx)
        assert isinstance(response, NodeTypeListResponse)
        return [row.type for row in response.data]

    return run


def test_decision_node_type_is_hidden_while_its_switch_is_off(
    config_overrides: Callable[..., None],
    list_types: Callable[[], list[str]],
    describe: Callable[[str], NodeTypeDetailResponse],
) -> None:
    config_overrides(ENABLE_DECISION_NODE=False)

    assert "decision" not in list_types()
    with pytest.raises(NodeTypeNotFound):
        describe("decision")


def test_decision_node_type_is_offered_while_its_switch_is_on(
    config_overrides: Callable[..., None],
    list_types: Callable[[], list[str]],
    describe: Callable[[str], NodeTypeDetailResponse],
) -> None:
    config_overrides(ENABLE_DECISION_NODE=True)

    assert "decision" in list_types()
    assert describe("decision").type == "decision"


def test_http_request_default_body_carries_an_empty_data_list(
    describe: Callable[[str], NodeTypeDetailResponse],
) -> None:
    graphon_default = HttpRequestNode.get_default_config()
    graphon_config = cast(Mapping[str, object], graphon_default["config"])
    assert "data" not in cast(Mapping[str, object], graphon_config["body"])

    response = describe(BuiltinNodeTypes.HTTP_REQUEST)

    assert response.default_config["config"]["body"] == {"type": "none", "data": []}
    assert response.default_config["config"]["method"] == graphon_config["method"]
    assert response.default_config["retry_config"] == graphon_default["retry_config"]


def test_keys_the_default_already_has_are_kept(
    describe: Callable[[str], NodeTypeDetailResponse], sqlite_session_factory: sessionmaker[Session]
) -> None:
    graphon_default = WorkflowService(sqlite_session_factory).get_default_block_config(BuiltinNodeTypes.HTTP_REQUEST)
    graphon_timeout = cast(Mapping[str, object], cast(Mapping[str, object], graphon_default["config"])["timeout"])

    response = describe(BuiltinNodeTypes.HTTP_REQUEST)

    timeout = response.default_config["config"]["timeout"]
    assert {key: timeout[key] for key in graphon_timeout} == graphon_timeout


def test_sub_objects_that_fail_their_model_pass_through(describe: Callable[[str], NodeTypeDetailResponse]) -> None:
    graphon_default = CodeNode.get_default_config()

    response = describe(BuiltinNodeTypes.CODE)

    assert response.default_config == dict(graphon_default)


def test_human_input_description_matches_version_two(describe: Callable[[str], NodeTypeDetailResponse]) -> None:
    response = describe(BuiltinNodeTypes.HUMAN_INPUT)

    assert response.version == "2"
    properties = response.schema_["properties"]
    assert {"recipients_spec", "message_template", "debug_mode"} <= properties.keys()
    assert "delivery_methods" not in properties
    config = response.default_config["config"]
    assert config["version"] == "2"
    assert config["recipients_spec"] == []
    assert config["message_template"] == {
        "subject": "Action required",
        "body": (
            "A request is waiting for your review. Please review the details and submit your decision to continue. "
            "Review and respond: {{#url#}}"
        ),
    }
    assert config["debug_mode"] == {"enabled": False, "channels": []}
    assert "delivery_methods" not in config
