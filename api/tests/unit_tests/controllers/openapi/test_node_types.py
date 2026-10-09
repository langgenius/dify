from collections.abc import Callable, Mapping
from types import SimpleNamespace
from typing import Protocol, cast
from unittest.mock import Mock

import pytest
from flask import Flask

from controllers.openapi import node_types
from controllers.openapi._models import NodeTypeDetailResponse
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.subjects import Subject
from graphon.enums import BuiltinNodeTypes
from graphon.nodes.http_request import HttpRequestNode
from graphon.nodes.llm import LLMNode


class _EndpointView(Protocol):
    __handler__: Callable[..., object]


def _describe(app: Flask, monkeypatch: pytest.MonkeyPatch, node_type: str, default: object) -> NodeTypeDetailResponse:
    service = Mock()
    service.get_default_block_config.return_value = default
    monkeypatch.setattr(node_types, "WorkflowService", lambda: service)
    ctx = Context(cast(Subject, SimpleNamespace()), Mock(), {"node_type": node_type})
    api = node_types.NodeTypeDetailApi()
    with app.test_request_context(f"/openapi/v1/node-types/{node_type}"):
        return cast(NodeTypeDetailResponse, cast(_EndpointView, api.get).__handler__(api, ctx, node_type))


def test_http_request_default_body_carries_an_empty_data_list(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    """graphon's default omits `body.data`; a DSL copied from it crashed the web editor on load."""
    graphon_default = HttpRequestNode.get_default_config()
    graphon_config = cast(Mapping[str, object], graphon_default["config"])
    assert "data" not in cast(Mapping[str, object], graphon_config["body"])

    response = _describe(app, monkeypatch, BuiltinNodeTypes.HTTP_REQUEST, graphon_default)

    assert response.default_config["config"]["body"] == {"type": "none", "data": []}
    assert response.default_config["config"]["method"] == graphon_config["method"]
    assert response.default_config["retry_config"] == graphon_default["retry_config"]


def test_other_node_type_defaults_pass_through(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    graphon_default = LLMNode.get_default_config()

    response = _describe(app, monkeypatch, BuiltinNodeTypes.LLM, graphon_default)

    assert response.default_config == dict(graphon_default)
