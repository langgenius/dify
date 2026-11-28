"""Exercise the authenticated Agent config routes with the composed service and SQLite."""

import io
import zipfile
from collections.abc import Iterator
from dataclasses import dataclass
from http import HTTPStatus
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import pytest
from flask import Flask
from flask.testing import FlaskClient
from redis import Redis
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from controllers.console.wraps import _is_setup_completed
from controllers.inner_api import bp
from core.tools.signature import verify_tool_file_signature
from enums import DeploymentEdition
from extensions.ext_application_services import build_application_services
from extensions.ext_database import db
from extensions.ext_redis import RedisClientWrapper
from extensions.ext_storage import storage
from extensions.storage.opendal_storage import OpenDALStorage
from models import DifySetup
from models.agent import Agent, AgentConfigDraft, AgentConfigDraftType, AgentConfigSnapshot, AgentScope, AgentSource
from models.agent_config_entities import AgentConfigSkillRefConfig, AgentSoulConfig, AgentSoulPromptConfig
from models.tools import ToolFile
from tests.helpers.unit.config_override import config_overrides_context

_HEADERS = {"X-Inner-Api-Key": "agent-config-test"}
_INITIAL_PROMPT = "  原文 [§file:guide.md:Guide§]\r\n\n"
_SKILL_MARKDOWN = "# Research\n"
_ARCHIVE_KEY = "config-skills/research.zip"


@dataclass(frozen=True)
class ConfigTarget:
    """Use a real Inner API client against one Agent's persisted config and archive."""

    client: FlaskClient
    agent_id: str
    tenant_id: str
    account_id: str
    draft_id: str
    snapshot_id: str
    tool_file_id: str
    archive_size: int

    @property
    def url(self) -> str:
        """Return the registered Inner API route prefix for this Agent."""
        return f"/inner/api/agent-config/{self.agent_id}"

    @property
    def query(self) -> dict[str, str]:
        """Return the exact identifiers needed to resolve the seeded private draft."""
        return {
            "tenant_id": self.tenant_id,
            "user_id": self.account_id,
            "config_version_id": self.draft_id,
            "config_version_kind": "build_draft",
        }

    @property
    def snapshot_query(self) -> dict[str, str]:
        """Return a query for the Agent's immutable snapshot."""
        return {**self.query, "config_version_id": self.snapshot_id, "config_version_kind": "snapshot"}


@pytest.fixture
def config_target(
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
    tmp_path: Path,
) -> Iterator[ConfigTarget]:
    """Register real routes and seed a workspace Agent, its config versions, and a skill archive."""
    with (
        Redis() as connection,
        config_overrides_context(
            DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY,
            INIT_PASSWORD="",
            PLUGIN_DAEMON_KEY="enabled",
            INNER_API_KEY_FOR_PLUGIN=_HEADERS["X-Inner-Api-Key"],
        ),
    ):
        app = Flask(__name__)
        app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False, SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url))
        db.init_app(app)
        redis = RedisClientWrapper()
        redis.initialize(connection)
        app.extensions["application_services"] = build_application_services(
            database_client=sqlite_session_factory,
            deployment_edition=DeploymentEdition.COMMUNITY,
            initialization_password="",
            redis=redis,
        )
        app.register_blueprint(bp)

        tenant_id, account_id = str(uuid4()), str(uuid4())
        agent = Agent(tenant_id=tenant_id, name="Config Agent", scope=AgentScope.ROSTER, source=AgentSource.ROSTER)
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, mode="w") as archive:
            archive.writestr("SKILL.md", _SKILL_MARKDOWN)
        payload = buffer.getvalue()
        tool_file = ToolFile(
            user_id=str(uuid4()),
            tenant_id=tenant_id,
            conversation_id=None,
            file_key=_ARCHIVE_KEY,
            mimetype="application/zip",
            name="research.zip",
            size=len(payload),
        )
        soul = AgentSoulConfig(
            prompt=AgentSoulPromptConfig(system_prompt=_INITIAL_PROMPT),
            config_skills=[
                AgentConfigSkillRefConfig(
                    name="research", file_id=tool_file.id, size=tool_file.size, description="Research skills"
                )
            ],
        )
        draft = AgentConfigDraft(
            tenant_id=tenant_id,
            agent_id=agent.id,
            account_id=account_id,
            draft_type=AgentConfigDraftType.DEBUG_BUILD,
            draft_owner_key=account_id,
            config_snapshot=soul,
        )
        snapshot = AgentConfigSnapshot(tenant_id=tenant_id, agent_id=agent.id, version=1, config_snapshot=soul)
        with sqlite_session_factory.begin() as session:
            session.add_all([DifySetup(version="test"), agent, tool_file, draft, snapshot])

        runner = OpenDALStorage(scheme="fs", root=str(tmp_path))
        runner.save(_ARCHIVE_KEY, payload)
        previous_runner = vars(storage).get("storage_runner")
        storage.storage_runner = runner
        _is_setup_completed.reset_success()
        try:
            yield ConfigTarget(
                app.test_client(), agent.id, tenant_id, account_id, draft.id, snapshot.id, tool_file.id, len(payload)
            )
        finally:
            _is_setup_completed.reset_success()
            if previous_runner is None:
                del storage.storage_runner
            else:
                storage.storage_runner = previous_runner


def test_manifest_reads_the_exact_agent_config(config_target: ConfigTarget) -> None:
    """Expose the selected private draft's manifest after Inner API authentication."""
    target = config_target
    response = target.client.get(f"{target.url}/manifest", headers=_HEADERS, query_string=target.query)

    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {
        "agent_id": target.agent_id,
        "config_version": {"id": target.draft_id, "kind": "build_draft", "writable": True},
        "skills": {
            "items": [
                {
                    "id": "research",
                    "name": "research",
                    "file_id": target.tool_file_id,
                    "is_missing": False,
                    "description": "Research skills",
                    "size": target.archive_size,
                    "hash": None,
                    "mime_type": "application/zip",
                }
            ]
        },
        "files": {"items": []},
        "env_keys": [],
        "note": "",
    }


def test_download_request_issues_an_origin_free_signed_uri(config_target: ConfigTarget) -> None:
    """Authorize the referenced skill and expose metadata and a signed path without archive bytes."""
    target = config_target
    response = target.client.post(
        f"{target.url}/download-request",
        headers=_HEADERS,
        json={**target.query, "config": {"kind": "skill", "name": "research"}},
    )

    assert response.status_code == HTTPStatus.OK
    result = response.get_json()
    assert set(result) == {"filename", "mime_type", "size", "download_uri"}
    assert result["filename"] == "research.zip"
    assert result["mime_type"] == "application/zip"
    assert result["size"] == target.archive_size
    uri = urlsplit(result["download_uri"])
    assert not uri.scheme
    assert not uri.netloc
    assert uri.path == f"/files/tools/{target.tool_file_id}.zip"
    params = parse_qs(uri.query)
    assert params["as_attachment"] == ["true"]
    assert verify_tool_file_signature(
        target.tool_file_id, params["timestamp"][0], params["nonce"][0], params["sign"][0]
    )


def test_skill_inspect_reads_the_stored_archive(config_target: ConfigTarget) -> None:
    """Read the authorized tool file through storage and return parsed archive metadata."""
    target = config_target
    response = target.client.get(f"{target.url}/skills/research/inspect", headers=_HEADERS, query_string=target.query)

    assert response.status_code == HTTPStatus.OK
    result = response.get_json()
    assert result["name"] == "research"
    assert result["file_id"] == target.tool_file_id
    assert result["files"] == [
        {"path": "SKILL.md", "name": "SKILL.md", "type": "file", "previewable": True, "downloadable": True}
    ]
    assert result["skill_md"]["text"] == _SKILL_MARKDOWN


def test_push_env_and_note_update_the_private_draft(config_target: ConfigTarget) -> None:
    """Authenticate each mutation and observe the committed state through a later manifest request."""
    target = config_target
    response = target.client.post(
        f"{target.url}/push",
        headers=_HEADERS,
        json={
            **target.query,
            "files": [{"name": "copy.zip", "file_ref": {"kind": "tool_file", "id": target.tool_file_id}}],
            "env_text": "KEY=value\n",
            "note": "hello",
        },
    )
    assert response.status_code == HTTPStatus.OK
    manifest = response.get_json()
    assert manifest["files"]["items"][0]["file_id"] == target.tool_file_id
    assert manifest["env_keys"] == ["KEY"]
    assert manifest["note"] == "hello"

    response = target.client.patch(
        f"{target.url}/env", headers=_HEADERS, json={**target.query, "env_text": "NEW=value"}
    )
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"env_keys": ["KEY", "NEW"]}

    response = target.client.put(f"{target.url}/note", headers=_HEADERS, json={**target.query, "note": "updated"})
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"note": "updated"}

    response = target.client.get(f"{target.url}/manifest", headers=_HEADERS, query_string=target.query)
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {**manifest, "env_keys": ["KEY", "NEW"], "note": "updated"}


@pytest.mark.parametrize("prompt", ["  Updated [§skill:research:Research§]\r\n\n", ""])
def test_prompt_reads_and_replaces_raw_text(config_target: ConfigTarget, prompt: str) -> None:
    """Preserve unexpanded mentions, whitespace, and explicit empty prompt updates."""
    target = config_target
    path = f"{target.url}/prompt"
    response = target.client.get(path, headers=_HEADERS, query_string=target.query)
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"prompt": _INITIAL_PROMPT}

    response = target.client.put(path, headers=_HEADERS, json={**target.query, "prompt": prompt})
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"prompt": prompt}

    response = target.client.get(path, headers=_HEADERS, query_string=target.query)
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"prompt": prompt}


@pytest.mark.parametrize("headers", [{}, {"X-Inner-Api-Key": "wrong"}])
def test_agent_config_requires_inner_api_key(config_target: ConfigTarget, headers: dict[str, str]) -> None:
    """Hide every config route from callers without the configured Inner API key."""
    target = config_target
    routes: tuple[tuple[str, str, dict[str, object]], ...] = (
        ("GET", "manifest", {}),
        ("POST", "download-request", {"config": {"kind": "skill", "name": "research"}}),
        ("GET", "skills/research/inspect", {}),
        ("POST", "push", {"note": "unauthorized"}),
        ("PATCH", "env", {"env_text": "KEY=value"}),
        ("PUT", "note", {"note": "unauthorized"}),
        ("GET", "prompt", {}),
        ("PUT", "prompt", {"prompt": "unauthorized"}),
    )
    for method, path, payload in routes:
        response = target.client.open(
            f"{target.url}/{path}",
            method=method,
            headers=headers,
            query_string=target.query,
            json={**target.query, **payload},
        )
        assert response.status_code == HTTPStatus.NOT_FOUND, path


@pytest.mark.parametrize("prompt", [{}, {"prompt": None}, {"prompt": 123}])
def test_prompt_rejects_missing_null_and_non_string_text(
    config_target: ConfigTarget, prompt: dict[str, object]
) -> None:
    """Reject malformed prompt updates without replacing the existing prompt."""
    target = config_target
    response = target.client.put(f"{target.url}/prompt", headers=_HEADERS, json={**target.query, **prompt})

    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "invalid_request"
    assert target.client.get(f"{target.url}/prompt", headers=_HEADERS, query_string=target.query).get_json() == {
        "prompt": _INITIAL_PROMPT
    }


def test_agent_config_rejects_invalid_queries_and_payloads(config_target: ConfigTarget) -> None:
    """Reject incomplete version selectors, invalid source names, and incomplete push requests."""
    target = config_target
    responses = (
        target.client.get(f"{target.url}/manifest", headers=_HEADERS, query_string={"tenant_id": target.tenant_id}),
        target.client.post(
            f"{target.url}/download-request",
            headers=_HEADERS,
            json={**target.query, "config": {"kind": "file", "name": "../guide.txt"}},
        ),
        target.client.post(f"{target.url}/push", headers=_HEADERS, json={"tenant_id": target.tenant_id}),
    )
    for response in responses:
        assert response.status_code == HTTPStatus.BAD_REQUEST
        error = response.get_json()
        assert error["code"] == "invalid_request"
        assert set(error) == {"code", "message"}


def test_foreign_build_draft_is_hidden(config_target: ConfigTarget) -> None:
    """Treat the exact private draft as missing when the execution account does not own it."""
    target = config_target
    query = {**target.query, "user_id": str(uuid4())}
    error = {"code": "config_version_not_found", "message": "agent config version was not found"}
    manifest = target.client.get(f"{target.url}/manifest", headers=_HEADERS, query_string=query)
    prompt = target.client.get(f"{target.url}/prompt", headers=_HEADERS, query_string=query)

    assert manifest.status_code == prompt.status_code == HTTPStatus.NOT_FOUND
    assert manifest.get_json() == error
    assert prompt.get_json() == {**error, "status": HTTPStatus.NOT_FOUND}


def test_push_and_prompt_report_that_a_snapshot_cannot_change(config_target: ConfigTarget) -> None:
    """Reject mutations against a snapshot and preserve each route's existing error envelope."""
    target = config_target
    error = {"code": "config_not_writable", "message": "config push is only allowed for build drafts"}
    push = target.client.post(f"{target.url}/push", headers=_HEADERS, json={**target.snapshot_query, "note": "updated"})
    prompt = target.client.put(
        f"{target.url}/prompt", headers=_HEADERS, json={**target.snapshot_query, "prompt": "updated"}
    )

    assert push.status_code == prompt.status_code == HTTPStatus.FORBIDDEN
    assert push.get_json() == error
    assert prompt.get_json() == {**error, "status": HTTPStatus.FORBIDDEN}
    saved = target.client.get(f"{target.url}/prompt", headers=_HEADERS, query_string=target.snapshot_query)
    assert saved.status_code == HTTPStatus.OK
    assert saved.get_json() == {"prompt": _INITIAL_PROMPT}
