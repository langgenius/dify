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

NO_CANVAS_KEYS = frozenset({"example", "purpose"})
EMPTY_VALUES: tuple[object, ...] = ("", [], {})


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
            response = handler(api, ctx, node_type, query=query)
        assert isinstance(response, NodeTypeDetailResponse)
        return response

    return run


def _rows(response: NodeTypeDetailResponse) -> dict[str, NodeTypeFieldRow]:
    return {str(row.loc[0]): row for row in response.fields}


def test_describe_llm_is_compact(describe: _Describe) -> None:
    response = describe(BuiltinNodeTypes.LLM)

    assert "schema" not in response.model_dump(mode="json", by_alias=True)
    assert {"type": "llm", "version": "1", "title": "llm"}.items() <= response.seed.items()
    assert "context" in response.seed
    rows = _rows(response)
    assert rows["model"].required is True
    assert response.handles == ["source"]


def test_fields_list_required_ones_first_then_by_loc(describe: _Describe) -> None:
    order = [(not row.required, row.loc) for row in describe(BuiltinNodeTypes.LLM).fields]

    assert order == sorted(order)


def test_describe_llm_seed_has_no_empty_value_in_a_required_field(describe: _Describe) -> None:
    response = describe(BuiltinNodeTypes.LLM)
    rows = _rows(response)
    seed = response.seed

    assert not [key for key, value in seed.items() if value in EMPTY_VALUES and rows[key].required]
    assert seed["context"] == {"enabled": False, "variable_selector": []}
    assert {"provider", "name"}.isdisjoint(seed["model"])


def test_the_llm_reply_stays_small_with_items_included(describe: _Describe) -> None:
    body = describe(BuiltinNodeTypes.LLM).model_dump_json(by_alias=True)

    assert len(body.encode()) < 1900, (
        "measured 1871 bytes: prompt_template and default_value list their item fields, no example or purpose key, "
        "and the seed keeps the canvas's empty values outside required fields"
    )


def test_rows_leave_out_what_the_seed_already_holds(describe: _Describe) -> None:
    response = describe(BuiltinNodeTypes.LLM)

    assert {"type", "title", "version", "desc"}.isdisjoint(_rows(response))
    assert all(NO_CANVAS_KEYS.isdisjoint(row.model_dump(mode="json")) for row in response.fields)


def test_rows_carry_only_the_parts_they_have(describe: _Describe) -> None:
    rows = {name: row.model_dump(mode="json") for name, row in _rows(describe(BuiltinNodeTypes.LLM)).items()}

    assert "options" not in rows["model"]
    assert rows["reasoning_format"]["options"] == ["separated", "tagged"]
    assert rows["reasoning_format"]["default"] == "tagged"
    assert "\n" not in rows["reasoning_format"]["description"]
    assert rows["reasoning_format"]["description"].startswith("Strategy for handling model reasoning output.")
    assert "default" not in rows["memory"]
    assert "description" not in rows["model"]


def test_a_list_row_carries_its_item_fields(describe: _Describe) -> None:
    rows = {name: row.model_dump(mode="json") for name, row in _rows(describe(BuiltinNodeTypes.END)).items()}

    items = {item["loc"][0]: item for item in rows["outputs"]["items"]}
    assert {"variable", "value_selector"} <= items.keys()
    assert items["variable"]["required"] is True
    assert all(NO_CANVAS_KEYS.isdisjoint(item) and "items" not in item for item in items.values())


def test_a_row_that_is_not_a_list_of_objects_leaves_out_items(describe: _Describe) -> None:
    rows = {name: row.model_dump(mode="json") for name, row in _rows(describe(BuiltinNodeTypes.LLM)).items()}

    assert "items" not in rows["model"]


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
    assert all(NO_CANVAS_KEYS.isdisjoint(row.model_dump(mode="json")) for row in response.fields)


def test_describe_node_type_human_input_describes_the_v2_node(describe: _Describe) -> None:
    response = describe(BuiltinNodeTypes.HUMAN_INPUT, include_schema=True)

    assert response.schema_ is not None
    properties = response.schema_["properties"]
    assert response.version == "2"
    assert {"recipients_spec", "message_template"} <= set(properties)
    assert "delivery_methods" not in properties
    assert {"recipients_spec", "user_actions"} <= set(_rows(response))
