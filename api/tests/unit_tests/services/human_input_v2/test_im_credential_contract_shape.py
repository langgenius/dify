"""Static and runtime ownership contracts for Provider credentials."""

from __future__ import annotations

import ast
from pathlib import Path

from core.human_input_v2.im_integration.adapters import dingtalk, feishu_lark, ms_teams, slack, wecom
from core.human_input_v2.im_provider import (
    DingTalkIMIntegrationCredentials,
    FeishuIMIntegrationCredentials,
    LarkIMIntegrationCredentials,
    MSTeamsIMIntegrationCredentials,
    SlackIMIntegrationCredentials,
    WeComIMIntegrationCredentials,
)

_API_ROOT = Path(__file__).resolve().parents[4]
_CANONICAL_CREDENTIAL_TYPES = (
    FeishuIMIntegrationCredentials,
    LarkIMIntegrationCredentials,
    SlackIMIntegrationCredentials,
    DingTalkIMIntegrationCredentials,
    MSTeamsIMIntegrationCredentials,
    WeComIMIntegrationCredentials,
)
_CANONICAL_CREDENTIAL_NAMES = tuple(model.__name__ for model in _CANONICAL_CREDENTIAL_TYPES)
_FORBIDDEN_IDENTIFIERS = ("Resolved" + "IMIntegrationCredentials", "Bounded" + "CredentialCipher")


def _production_python_sources() -> tuple[Path, ...]:
    sources: list[Path] = []
    for path in _API_ROOT.rglob("*.py"):
        relative_parts = path.relative_to(_API_ROOT).parts
        if "tests" in relative_parts or any(part.startswith(".") for part in relative_parts):
            continue
        sources.append(path)
    return tuple(sources)


def test_production_has_one_provider_union_one_adapter_and_no_superseded_names() -> None:
    provider_aliases: list[tuple[Path, ast.TypeAlias]] = []
    provider_adapter_calls: list[tuple[Path, ast.Call]] = []
    class_definitions: dict[str, list[Path]] = {name: [] for name in _CANONICAL_CREDENTIAL_NAMES}
    forbidden_occurrences: list[tuple[Path, str]] = []

    for path in _production_python_sources():
        source = path.read_text()
        for forbidden_identifier in _FORBIDDEN_IDENTIFIERS:
            if forbidden_identifier in source:
                forbidden_occurrences.append((path.relative_to(_API_ROOT), forbidden_identifier))
        if not any(name in source for name in (*_CANONICAL_CREDENTIAL_NAMES, "IMProviderCredentials")):
            continue

        tree = ast.parse(source)
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef) and node.name in class_definitions:
                class_definitions[node.name].append(path.relative_to(_API_ROOT))
            if (
                isinstance(node, ast.TypeAlias)
                and isinstance(node.name, ast.Name)
                and node.name.id == "IMProviderCredentials"
            ):
                referenced_models = {
                    child.id
                    for child in ast.walk(node.value)
                    if isinstance(child, ast.Name) and child.id in _CANONICAL_CREDENTIAL_NAMES
                }
                if referenced_models == set(_CANONICAL_CREDENTIAL_NAMES):
                    provider_aliases.append((path.relative_to(_API_ROOT), node))
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "TypeAdapter"
                and len(node.args) == 1
                and isinstance(node.args[0], ast.Name)
                and node.args[0].id == "IMProviderCredentials"
            ):
                provider_adapter_calls.append((path.relative_to(_API_ROOT), node))

    assert forbidden_occurrences == []
    assert class_definitions == {
        name: [Path("core/human_input_v2/im_provider/contracts.py")] for name in _CANONICAL_CREDENTIAL_NAMES
    }
    assert len(provider_aliases) == 1
    alias_path, alias_node = provider_aliases[0]
    assert alias_path == Path("core/human_input_v2/im_integration/management.py")
    assert sorted(
        child.id
        for child in ast.walk(alias_node.value)
        if isinstance(child, ast.Name) and child.id in _CANONICAL_CREDENTIAL_NAMES
    ) == sorted(_CANONICAL_CREDENTIAL_NAMES)
    discriminator_fields = [
        child
        for child in ast.walk(alias_node.value)
        if isinstance(child, ast.Call) and isinstance(child.func, ast.Name) and child.func.id == "Field"
    ]
    assert len(discriminator_fields) == 1
    assert [
        keyword.value.value
        for keyword in discriminator_fields[0].keywords
        if keyword.arg == "discriminator" and isinstance(keyword.value, ast.Constant)
    ] == ["provider"]
    assert [path for path, _call in provider_adapter_calls] == [Path("services/human_input_v2/im_credential_codec.py")]


def test_adapter_modules_reuse_six_distinct_canonical_credential_identities() -> None:
    adapter_exports = (
        feishu_lark.FeishuIMIntegrationCredentials,
        feishu_lark.LarkIMIntegrationCredentials,
        slack.SlackIMIntegrationCredentials,
        dingtalk.DingTalkIMIntegrationCredentials,
        ms_teams.MSTeamsIMIntegrationCredentials,
        wecom.WeComIMIntegrationCredentials,
    )

    assert adapter_exports == _CANONICAL_CREDENTIAL_TYPES
    assert all(exported is canonical for exported, canonical in zip(adapter_exports, _CANONICAL_CREDENTIAL_TYPES))
    assert len({id(model) for model in _CANONICAL_CREDENTIAL_TYPES}) == 6
    assert {model.__module__ for model in _CANONICAL_CREDENTIAL_TYPES} == {"core.human_input_v2.im_provider.contracts"}
