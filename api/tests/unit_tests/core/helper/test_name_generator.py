from dataclasses import dataclass

from pytest_mock import MockerFixture

from core.helper.name_generator import generate_incremental_name, generate_provider_name
from core.plugin.entities.plugin_daemon import CredentialType


@dataclass
class _Provider:
    name: str


def test_generate_incremental_name_uses_next_highest_suffix() -> None:
    names = ["API KEY 1", "API KEY 3", "API KEY 2", "other", "", "API KEY x"]

    assert generate_incremental_name(names, "API KEY") == "API KEY 4"


def test_generate_incremental_name_returns_default_when_no_matches() -> None:
    assert generate_incremental_name(["custom", "  ", ""], "AUTH") == "AUTH 1"


def test_generate_provider_name_uses_credential_display_name() -> None:
    providers = [_Provider(name="API KEY 1"), _Provider(name="API KEY 2")]

    assert generate_provider_name(providers, CredentialType.API_KEY) == "API KEY 3"


def test_generate_provider_name_falls_back_on_generation_error(mocker: MockerFixture) -> None:
    mocker.patch("core.helper.name_generator.generate_incremental_name", side_effect=RuntimeError("boom"))

    assert generate_provider_name([], CredentialType.OAUTH2, fallback_context="ctx") == "AUTH 1"
