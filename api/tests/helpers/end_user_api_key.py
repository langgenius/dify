"""Real persistence and schema validation with deterministic external boundaries."""

import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any, override

from sqlalchemy.orm import Session, sessionmaker

from clients.plugin.auth import PluginCredentialAuthClient
from clients.plugin.auth_entities import CredentialCheckResult
from core.entities.provider_entities import ProviderConfig, ProviderConfigType
from core.plugin.entities.plugin_daemon import CredentialType
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import (
    ToolEntity,
    ToolIdentity,
    ToolProviderEntityWithPlugin,
    ToolProviderIdentity,
)
from core.tools.plugin_tool.provider import PluginToolProviderController
from libs.uuid_utils import uuidv7
from models.account import Account, AccountStatus
from models.enums import AppStatus, EndUserType
from models.model import App, AppMode, EndUser
from models.workflow import Workflow, WorkflowType
from repositories.end_user_connection_repository import EndUserConnectionRepository
from services.end_user_connection_adapters import ApiKeyConnectionTargetResolver, PluginApiKeyCredentialGateway
from services.end_user_connections.api_key import ApiKeyConnectionService
from services.end_user_connections.contracts import CreateApiKeyConnectionInput
from services.end_user_connections.entities import WebConnectionContext
from services.end_user_connections.errors import ConnectionConfigurationError

PROVIDER = "vendor/calendar/calendar"


class ScriptedAuth(PluginCredentialAuthClient):
    def __init__(self) -> None:
        self.result = CredentialCheckResult(status="valid", reason_code=None, retryable=False, checked_at=1792540800)
        self.on_check: Callable[[], None] | None = None
        self.calls: list[tuple[str, str, str, dict[str, Any]]] = []

    @override
    def check_provider_credentials(
        self,
        *,
        tenant_id: str,
        user_id: str,
        provider: str,
        credentials: Mapping[str, Any],
        credential_type: CredentialType,
    ) -> CredentialCheckResult:
        assert credential_type == CredentialType.API_KEY
        self.calls.append((tenant_id, user_id, provider, dict(credentials)))
        if callback := self.on_check:
            self.on_check = None
            callback()
        return self.result


def plugin_provider(tenant_id: str) -> PluginToolProviderController:
    label = I18nObject(en_US="Calendar")
    return PluginToolProviderController(
        entity=ToolProviderEntityWithPlugin(
            identity=ToolProviderIdentity(
                author="test", name=PROVIDER, label=label, description=label, icon="icon.svg"
            ),
            credentials_schema=[
                ProviderConfig(name="api_key", label=label, type=ProviderConfigType.SECRET_INPUT, required=True)
            ],
            tools=[ToolEntity(identity=ToolIdentity(author="test", name="read", label=label, provider=PROVIDER))],
        ),
        plugin_id="vendor/calendar",
        plugin_unique_identifier="vendor/calendar:1.0",
        tenant_id=tenant_id,
    )


class TestProviders(PluginApiKeyCredentialGateway):
    __test__ = False

    def __init__(self, auth: ScriptedAuth, controller: PluginToolProviderController) -> None:
        super().__init__(auth=auth)
        self.controller = controller

    @override
    def provider(self, tenant_id: str, provider: str) -> PluginToolProviderController:
        if tenant_id != self.controller.tenant_id or provider != PROVIDER:
            raise ConnectionConfigurationError()
        return self.controller


class TestCipher:
    __test__ = False

    def __init__(self) -> None:
        self.values: dict[str, tuple[str, dict[str, Any]]] = {}

    def encrypt(self, tenant_id: str, credentials: Mapping[str, Any]) -> str:
        ciphertext = "cipher:" + str(uuidv7())
        self.values[ciphertext] = (tenant_id, dict(credentials))
        return ciphertext

    def decrypt(self, tenant_id: str, ciphertext: str) -> dict[str, Any]:
        owner, value = self.values[ciphertext]
        assert tenant_id == owner
        return dict(value)


@dataclass
class ConnectionHarness:
    context: WebConnectionContext
    workflow_id: str
    repository: EndUserConnectionRepository
    service: ApiKeyConnectionService
    auth: ScriptedAuth
    cipher: TestCipher
    sessions: sessionmaker[Session]

    def command(self, secret: str = "original-secret") -> CreateApiKeyConnectionInput:
        return CreateApiKeyConnectionInput.model_validate(
            {
                "workflow_id": self.workflow_id,
                "node_id": "tool-1",
                "name": "My calendar",
                "credentials": {"api_key": secret},
            }
        )


def make_harness(sessions: sessionmaker[Session]) -> ConnectionHarness:
    tenant_id = str(uuidv7())
    with sessions.begin() as session:
        account = Account(
            name="Consumer",
            email=f"{uuidv7()}@example.com",
            status=AccountStatus.ACTIVE,
            interface_language="en-US",
            timezone="UTC",
        )
        session.add(account)
        app = App(
            tenant_id=tenant_id,
            name="App",
            mode=AppMode.WORKFLOW,
            status=AppStatus.NORMAL,
            enable_site=True,
            enable_api=True,
        )
        session.add(app)
        session.flush()
        user = EndUser(
            tenant_id=tenant_id,
            app_id=app.id,
            type=EndUserType.BROWSER,
            account_id=account.id,
            session_id=str(uuidv7()),
            is_anonymous=False,
        )
        session.add(user)
        graph: dict[str, Any] = {
            "nodes": [
                {
                    "id": "tool-1",
                    "data": {
                        "type": "tool",
                        "provider_type": "builtin",
                        "provider_id": PROVIDER,
                        "tool_name": "read",
                        "credential_source": "end_user",
                        "end_user_auth": {"allowed_credential_types": ["api-key"], "purpose": "Read calendar"},
                    },
                }
            ],
            "edges": [],
        }
        workflow = Workflow(
            tenant_id=tenant_id,
            app_id=app.id,
            type=WorkflowType.WORKFLOW,
            version="published",
            graph=json.dumps(graph),
            _features="{}",
            created_by=account.id,
        )
        session.add(workflow)
        session.flush()
        app.workflow_id = workflow.id
        context = WebConnectionContext(tenant_id=tenant_id, app_id=app.id, end_user_id=user.id, account_id=account.id)
        workflow_id = workflow.id
    repository = EndUserConnectionRepository(session_factory=sessions)
    auth = ScriptedAuth()
    cipher = TestCipher()
    gateway = TestProviders(auth, plugin_provider(tenant_id))
    service = ApiKeyConnectionService(
        store=repository,
        targets=ApiKeyConnectionTargetResolver(workflows=repository, providers=gateway),
        credentials=gateway,
        cipher=cipher,
    )
    return ConnectionHarness(context, workflow_id, repository, service, auth, cipher, sessions)
