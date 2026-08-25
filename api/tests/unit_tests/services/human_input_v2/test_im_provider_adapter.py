"""Contracts for the shared IM provider adapter builder."""

from __future__ import annotations

import inspect

import pytest

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration import adapters
from core.human_input_v2.im_integration.adapters import (
    DingTalkCredentials,
    FeishuCredentials,
    LarkCredentials,
    MSTeamsCredentials,
    SlackCredentials,
    WeComCredentials,
    build_im_provider_adapter,
)
from core.human_input_v2.im_integration.adapters.credentials import IMProviderCredentials
from core.human_input_v2.im_integration.adapters.dingtalk import DingTalkIMProviderAdapter
from core.human_input_v2.im_integration.adapters.feishu_lark import (
    FeishuIMProviderAdapter,
    LarkIMProviderAdapter,
)
from core.human_input_v2.im_integration.adapters.ms_teams import MSTeamsIMProviderAdapter
from core.human_input_v2.im_integration.adapters.slack import SlackIMProviderAdapter
from core.human_input_v2.im_integration.adapters.wecom import WeComIMProviderAdapter

_CASES: tuple[tuple[IMProviderCredentials, type[object]], ...] = (
    (
        SlackCredentials(
            provider=IMProvider.SLACK,
            client_id="slack-client",
            client_secret="slack-client-secret",
            signing_secret="slack-signing-secret",
            bot_token="xoxb-slack-bot-token",
            app_token="xapp-slack-app-token",
        ),
        SlackIMProviderAdapter,
    ),
    (
        FeishuCredentials(
            provider=IMProvider.FEISHU,
            app_id="feishu-app",
            app_secret="feishu-secret",
            verification_token="feishu-verification",
            encrypt_key="feishu-encrypt-key",
        ),
        FeishuIMProviderAdapter,
    ),
    (
        LarkCredentials(
            provider=IMProvider.LARK,
            app_id="lark-app",
            app_secret="lark-secret",
            verification_token=None,
            encrypt_key=None,
        ),
        LarkIMProviderAdapter,
    ),
    (
        DingTalkCredentials(
            provider=IMProvider.DING_TALK,
            corp_id="dingtalk-corp",
            client_id="dingtalk-client",
            client_secret="dingtalk-secret",
        ),
        DingTalkIMProviderAdapter,
    ),
    (
        MSTeamsCredentials(
            provider=IMProvider.MS_TEAMS,
            tenant_id="00000000-0000-0000-0000-000000000001",
            client_id="00000000-0000-0000-0000-000000000002",
            client_secret="ms-teams-secret",
        ),
        MSTeamsIMProviderAdapter,
    ),
    (
        WeComCredentials(
            provider=IMProvider.WE_COM,
            corp_id="wecom-corp",
            agent_id="1001",
            secret="wecom-secret",
        ),
        WeComIMProviderAdapter,
    ),
)


@pytest.mark.parametrize(("credentials", "expected_type"), _CASES, ids=lambda value: str(value))
def test_builder_dispatches_each_resolved_credential_to_its_exact_adapter(
    credentials: IMProviderCredentials,
    expected_type: type[object],
) -> None:
    adapter = build_im_provider_adapter(credentials)

    try:
        assert type(adapter) is expected_type
    finally:
        adapter.close()


def test_builder_rejects_an_unsupported_object() -> None:
    with pytest.raises(TypeError, match="unsupported IM provider credentials"):
        build_im_provider_adapter(object())  # type: ignore[arg-type]


def test_builder_accepts_only_already_resolved_credentials() -> None:
    signature = inspect.signature(build_im_provider_adapter)

    assert tuple(signature.parameters) == ("credentials",)
    assert signature.parameters["credentials"].default is inspect.Parameter.empty


def test_builder_is_exported_by_the_adapter_boundary() -> None:
    assert adapters.build_im_provider_adapter is build_im_provider_adapter
    assert "build_im_provider_adapter" in adapters.__all__
