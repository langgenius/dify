"""App detail responses must not write masked configuration back to storage."""

import json

from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from models.model import AppMode, AppModelConfig
from tests.test_containers_integration_tests.controllers.console.helpers import (
    authenticate_console_client,
    create_console_account_and_tenant,
    create_console_app,
)


def test_put_app_detail_preserves_agent_tool_secret_after_commit(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.AGENT_CHAT)
    agent_mode = {
        "enabled": True,
        "strategy": "react",
        "tools": [
            {
                "provider_type": "api",
                "provider_id": "00000000-0000-0000-0000-000000000001",
                "tool_name": "private_tool",
                "tool_parameters": {"api_key": "encrypted-secret"},
            }
        ],
    }
    config = AppModelConfig(app_id=app.id, agent_mode=json.dumps(agent_mode))
    db_session_with_containers.add(config)
    db_session_with_containers.flush()
    app.app_model_config_id = config.id
    db_session_with_containers.commit()

    headers = authenticate_console_client(test_client_with_containers, account)
    response = test_client_with_containers.put(
        f"/console/api/apps/{app.id}",
        headers=headers,
        json={"name": "Updated App"},
    )

    assert response.status_code == 200
    assert response.json is not None
    assert response.json["model_config"]["agent_mode"]["tools"][0]["tool_parameters"] != {"api_key": "encrypted-secret"}
    with Session(db_session_with_containers.get_bind()) as reread_session:
        persisted = reread_session.get(AppModelConfig, config.id)
        assert persisted is not None
        assert persisted.agent_mode is not None
        assert json.loads(persisted.agent_mode) == agent_mode


def test_get_and_put_app_detail_preserve_historical_agent_mode_without_tools(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    app = create_console_app(db_session_with_containers, tenant.id, account.id, AppMode.AGENT_CHAT)
    agent_mode = {"enabled": True, "max_iteration": 5, "strategy": "function_call"}
    config = AppModelConfig(app_id=app.id, agent_mode=json.dumps(agent_mode))
    db_session_with_containers.add(config)
    db_session_with_containers.flush()
    app.app_model_config_id = config.id
    db_session_with_containers.commit()

    headers = authenticate_console_client(test_client_with_containers, account)
    get_response = test_client_with_containers.get(f"/console/api/apps/{app.id}", headers=headers)
    assert get_response.status_code == 200
    assert get_response.json is not None
    assert get_response.json["model_config"]["agent_mode"] == agent_mode

    put_response = test_client_with_containers.put(
        f"/console/api/apps/{app.id}", headers=headers, json={"name": "Updated App"}
    )
    assert put_response.status_code == 200
    assert put_response.json is not None
    assert put_response.json["model_config"]["agent_mode"] == agent_mode

    with Session(db_session_with_containers.get_bind()) as reread_session:
        persisted = reread_session.get(AppModelConfig, config.id)
        assert persisted is not None
        assert persisted.agent_mode == json.dumps(agent_mode)
