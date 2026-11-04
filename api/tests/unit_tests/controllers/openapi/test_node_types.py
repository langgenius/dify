import uuid
from collections.abc import Callable
from typing import Protocol, cast

import pytest
from flask import Flask
from sqlalchemy.orm import Session

from constants.oauth_bearer import TokenType
from controllers.openapi import node_types
from controllers.openapi._errors import NodeTypeNotFound
from controllers.openapi._models import NodeTypeDescribeQuery, NodeTypeDetailResponse, NodeTypeFieldRow
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.subjects import AccountSubject
from graphon.enums import BuiltinNodeTypes
from libs.oauth_bearer import AuthContext


class _EndpointView(Protocol):
    __handler__: Callable[..., object]


type _Describe = Callable[..., NodeTypeDetailResponse]


@pytest.fixture
def describe(app: Flask, sqlite_session: Session) -> _Describe:
    auth = AuthContext(
        token_type=TokenType.OAUTH_ACCOUNT,
        subject_email="caller@example.com",
        subject_issuer="dify:account",
        account_id=uuid.uuid4(),
        client_id="difyctl",
        token_id=uuid.uuid4(),
        expires_at=None,
    )

    def run(node_type: str, *, include_schema: bool = False) -> NodeTypeDetailResponse:
        ctx = Context(AccountSubject(auth), sqlite_session, {"node_type": node_type})
        api = node_types.NodeTypeDetailApi()
        query = NodeTypeDescribeQuery(include_schema=include_schema)
        handler = cast(_EndpointView, api.get).__handler__
        with app.test_request_context(f"/openapi/v1/node-types/{node_type}"):
            return cast(NodeTypeDetailResponse, handler(api, ctx, node_type, query=query))

    return run


def _rows(response: NodeTypeDetailResponse) -> dict[str, NodeTypeFieldRow]:
    return {str(row.loc[0]): row for row in response.fields}


def test_describe_llm_is_compact(describe: _Describe) -> None:
    response = describe(BuiltinNodeTypes.LLM)

    assert "schema" not in response.model_dump(mode="json", by_alias=True)
    assert "default_config" not in response.model_dump(mode="json")
    assert {"type": "llm", "version": "1", "title": "llm"}.items() <= response.seed.items()
    assert "context" in response.seed
    rows = _rows(response)
    assert rows["model"].required is True
    assert rows["model"].purpose is True
    assert rows["context"].purpose is False
    assert response.handles == ["source"]


def test_fields_list_required_ones_first_then_by_loc(describe: _Describe) -> None:
    order = [(not row.required, row.loc) for row in describe(BuiltinNodeTypes.LLM).fields]

    assert order == sorted(order)


def test_a_field_row_carries_the_canvas_example(describe: _Describe) -> None:
    rows = _rows(describe(BuiltinNodeTypes.LLM))

    assert rows["context"].example == {"enabled": False, "variable_selector": []}


def test_include_schema_adds_the_json_schema(describe: _Describe) -> None:
    response = describe(BuiltinNodeTypes.LLM, include_schema=True)

    assert response.schema_ is not None
    assert "model" in response.schema_["properties"]
    assert "schema" in response.model_dump(mode="json", by_alias=True)
    assert response.fields


def test_unknown_type_is_404(describe: _Describe) -> None:
    with pytest.raises(NodeTypeNotFound):
        describe("no-such-node")


def test_if_else_handles_follow_the_seed_case_then_false(describe: _Describe) -> None:
    response = describe(BuiltinNodeTypes.IF_ELSE)

    [case] = response.seed["cases"]
    assert response.handles == [case["case_id"], "false"]


def test_a_type_the_canvas_gives_no_defaults_still_answers(describe: _Describe) -> None:
    response = describe(BuiltinNodeTypes.TOOL)

    assert response.seed == {"type": "tool", "version": "1", "title": "tool"}
    assert not any(row.purpose for row in response.fields)


def test_describe_node_type_human_input_describes_the_v2_node(describe: _Describe) -> None:
    response = describe(BuiltinNodeTypes.HUMAN_INPUT, include_schema=True)

    assert response.schema_ is not None
    properties = response.schema_["properties"]
    assert response.version == "2"
    assert {"recipients_spec", "message_template"} <= set(properties)
    assert "delivery_methods" not in properties
    rows = _rows(response)
    assert rows["recipients_spec"].purpose is True
    assert rows["user_actions"].purpose is True
