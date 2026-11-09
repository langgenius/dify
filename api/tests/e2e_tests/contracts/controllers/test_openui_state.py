"""Exercise OpenUI draft writes through each HTTP admission surface."""

import json
from collections.abc import Callable
from typing import Literal

import pytest
from flask import Blueprint
from sqlalchemy import update
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.test import TestResponse

from constants import COOKIE_NAME_CSRF_TOKEN, HEADER_NAME_CSRF_TOKEN
from controllers.console.app.message import AgentMessageOpenUIStateApi, MessageOpenUIStateApi
from controllers.console.explore.message import MessageOpenUIStateApi as InstalledAppOpenUIStateApi
from controllers.web.message import MessageOpenUIStateApi as WebOpenUIStateApi
from libs.external_api import ExternalApi
from libs.generative_ui import OpenUIContentBlock
from libs.passport import PassportService
from libs.token import generate_csrf_token
from models.model import Message
from tests.e2e_tests.contracts.controllers.console.explore.test_message_suggested_questions import (
    _Harness as ConsoleHarness,
)
from tests.e2e_tests.contracts.controllers.console.explore.test_message_suggested_questions import (
    harness as console_harness,
)
from tests.e2e_tests.contracts.controllers.console.test_message_feedback import _admin_route
from tests.e2e_tests.contracts.controllers.web.test_message_feedback import _Harness as WebHarness
from tests.e2e_tests.contracts.controllers.web.test_message_feedback import harness as web_harness

__all__ = ["console_harness", "web_harness"]

_STATE_ROUTE = "/messages/<uuid:message_id>/content-blocks/<string:block_id>/state"


def _assert_draft_contract(
    factory: sessionmaker[Session],
    message_id: str,
    put_state: Callable[[str, dict[str, object]], TestResponse],
    *,
    missing_code: str,
) -> None:
    block = OpenUIContentBlock(id=f"{message_id}:openui:0", status="completed", source='root = Text("Hello")')
    streaming = OpenUIContentBlock(id=f"{message_id}:openui:1")
    usage = {"total_tokens": 7}
    with factory.begin() as session:
        session.execute(
            update(Message)
            .where(Message.id == message_id)
            .values(
                message_metadata=json.dumps(
                    {
                        "content_blocks": [block.model_dump(mode="json"), streaming.model_dump(mode="json")],
                        "usage": usage,
                    }
                )
            )
        )

    form_state = {"name": "Alice", "filters": ["East", None]}
    payload: dict[str, object] = {"form_state": form_state}
    response = put_state(block.id, payload)
    assert response.status_code == 200
    saved = {**block.model_dump(mode="json"), "form_state": form_state}
    assert response.get_json() == {"block": saved}

    response = put_state(streaming.id, payload)
    assert response.status_code == 409
    assert response.get_json()["code"] == "openui_block_not_ready"

    response = put_state("missing", payload)
    assert response.status_code == 404
    assert response.get_json()["code"] == missing_code

    with factory() as session:
        message = session.get(Message, message_id)
        assert message is not None
        assert message.message_metadata_dict == {
            "content_blocks": [saved, streaming.model_dump(mode="json")],
            "usage": usage,
        }


@pytest.mark.parametrize("kind", ["app", "agent", "installed"])
def test_console_openui_draft_contract(
    console_harness: ConsoleHarness, kind: Literal["app", "agent", "installed"]
) -> None:
    state = console_harness
    api = ExternalApi(state.app)
    api.add_resource(MessageOpenUIStateApi, "/apps/<uuid:app_id>" + _STATE_ROUTE, endpoint="console.app_openui_state")
    api.add_resource(
        AgentMessageOpenUIStateApi, "/agent/<uuid:agent_id>" + _STATE_ROUTE, endpoint="console.agent_openui_state"
    )
    api.add_resource(
        InstalledAppOpenUIStateApi,
        "/installed-apps/<uuid:installed_app_id>" + _STATE_ROUTE,
        endpoint="console.installed_app_openui_state",
    )
    prefix = (
        f"/installed-apps/{state.installation.id}"
        if kind == "installed"
        else _admin_route(state, kind).removesuffix("/feedbacks")
    )
    client = state.app.test_client()
    csrf = generate_csrf_token(state.account.id)
    client.set_cookie(COOKIE_NAME_CSRF_TOKEN, csrf)
    headers = {
        "Authorization": f"Bearer {PassportService().issue({'user_id': state.account.id})}",
        HEADER_NAME_CSRF_TOKEN: csrf,
    }

    def put_state(block_id: str, payload: dict[str, object]) -> TestResponse:
        return client.put(
            f"{prefix}/messages/{state.message.id}/content-blocks/{block_id}/state", headers=headers, json=payload
        )

    _assert_draft_contract(
        state.factory,
        state.message.id,
        put_state,
        missing_code="message_not_found" if kind == "installed" else "not_found",
    )
    state.assert_closed()


def test_web_openui_draft_contract(web_harness: WebHarness) -> None:
    state = web_harness
    blueprint = Blueprint("openui_state", __name__)
    ExternalApi(blueprint).add_resource(WebOpenUIStateApi, _STATE_ROUTE)
    state.app.register_blueprint(blueprint)
    client = state.app.test_client()

    def put_state(block_id: str, payload: dict[str, object]) -> TestResponse:
        return client.put(
            f"/messages/{state.message.id}/content-blocks/{block_id}/state", headers=state.headers, json=payload
        )

    _assert_draft_contract(state.factory, state.message.id, put_state, missing_code="not_found")
    state.assert_closed()
