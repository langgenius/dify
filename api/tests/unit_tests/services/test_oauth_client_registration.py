import pytest

from services.oauth_client_metadata import MAX_REDIRECT_URIS, RegistrationErrorCode
from services.oauth_client_registration import OAuthClientRegistrationService, RegistrationError
from services.oauth_clients import OAuthClientRegistry
from services.oauth_token_contracts import GrantType
from tests.helpers.unit.services.oauth_authorization_code_fakes import FakeClientRepository

REDIRECT = "https://agent.example/cb"
BOTH_GRANTS = (GrantType.AUTHORIZATION_CODE, GrantType.REFRESH_TOKEN)


def _service() -> tuple[OAuthClientRegistrationService, FakeClientRepository]:
    repository = FakeClientRepository()
    return OAuthClientRegistrationService(clients=repository), repository


def _error(metadata: dict[str, object]) -> RegistrationError:
    service, _ = _service()
    with pytest.raises(RegistrationError) as raised:
        service.register(metadata)
    return raised.value


class TestRegisterCases:
    @staticmethod
    def test_client_gets_a_dcr_id() -> None:
        service, repository = _service()
        metadata: dict[str, object] = {
            "redirect_uris": [REDIRECT],
            "client_name": "Agent",
            "logo_uri": "https://agent.example/logo.png",
            "contacts": ["a@b.c"],
        }

        client = service.register(metadata)

        assert client.client_id.startswith("dcr_")
        assert client.client_name == "Agent"
        assert client.logo_uri == "https://agent.example/logo.png"
        assert client.grant_types == BOTH_GRANTS
        resolved = OAuthClientRegistry([repository]).resolve(client.client_id)
        assert resolved is not None
        assert resolved.redirect_uris == (REDIRECT,)
        assert resolved.grant_types == frozenset(BOTH_GRANTS)
        assert service.register(metadata).client_id != client.client_id

    @staticmethod
    def test_an_explicit_none_auth_method_is_accepted() -> None:
        service, _ = _service()

        assert service.register({"redirect_uris": [REDIRECT], "token_endpoint_auth_method": "none"}).client_id

    @staticmethod
    def test_blank_name_falls_back_to_the_redirect_host() -> None:
        service, _ = _service()

        assert service.register({"redirect_uris": [REDIRECT], "client_name": "   "}).client_name == "agent.example"


class TestRedirectUriCases:
    @staticmethod
    @pytest.mark.parametrize(
        "redirect_uris",
        [
            None,
            ["http://example.com/cb"],
            ["https://agent.example/cb#frag"],
            [f"https://agent.example/{index}" for index in range(MAX_REDIRECT_URIS + 1)],
        ],
    )
    def test_bad_redirect_uris_are_rejected(redirect_uris: object) -> None:
        metadata: dict[str, object] = {} if redirect_uris is None else {"redirect_uris": redirect_uris}

        assert _error(metadata).code == RegistrationErrorCode.INVALID_REDIRECT_URI

    @staticmethod
    def test_loopback_with_a_port_and_the_maximum_count_are_accepted() -> None:
        service, _ = _service()
        uris = ["http://127.0.0.1:8123/cb"] + [f"https://agent.example/{i}" for i in range(MAX_REDIRECT_URIS - 1)]

        assert service.register({"redirect_uris": uris}).redirect_uris == tuple(uris)


class TestInvalidMetadataCases:
    @staticmethod
    @pytest.mark.parametrize(
        "extra",
        [
            {"grant_types": ["urn:ietf:params:oauth:grant-type:device_code"]},
            {"response_types": ["token"]},
            {"token_endpoint_auth_method": "client_secret_basic"},
            {"token_endpoint_auth_method": "client_secret_post"},
            {"token_endpoint_auth_method": "private_key_jwt"},
            {"token_endpoint_auth_method": 1},
        ],
    )
    def test_bad_metadata_is_rejected(extra: dict[str, object]) -> None:
        error = _error({"redirect_uris": [REDIRECT], **extra})

        assert error.code == RegistrationErrorCode.INVALID_CLIENT_METADATA
        assert error.description
