import pytest

from enums.oauth_client import OAuthClientKind, TokenEndpointAuthMethod
from libs.oauth_bearer import sha256_hex
from repositories.oauth_authorization_code_repository import RedisAuthorizationCodeRepository
from services.oauth_authorize_service import OAuthAuthorizeService
from services.oauth_client_auth import authenticate_client
from services.oauth_client_registration import (
    MAX_REDIRECT_URIS,
    OAuthClientRegistrationService,
    RegistrationError,
    RegistrationErrorCode,
)
from services.oauth_clients import OAuthClientRegistry
from services.oauth_token_contracts import GrantType
from tests.helpers.unit.services.oauth_authorization_code_fakes import (
    DictRedis,
    FakeClientRepository,
    FakeTokenSettings,
    install_rate_limit_store,
)

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
    def test_public_client_gets_a_dcr_id_and_no_secret() -> None:
        service, repository = _service()

        client = service.register({"redirect_uris": [REDIRECT], "client_name": "Agent"})

        assert client.client_id.startswith("dcr_")
        assert client.client_secret is None
        assert client.client_name == "Agent"
        assert client.token_endpoint_auth_method == TokenEndpointAuthMethod.NONE
        assert client.grant_types == BOTH_GRANTS
        resolved = OAuthClientRegistry([repository]).resolve(client.client_id)
        assert resolved is not None
        assert resolved.kind == OAuthClientKind.PUBLIC
        assert resolved.redirect_uris == (REDIRECT,)
        assert resolved.grant_types == frozenset(BOTH_GRANTS)

    @staticmethod
    def test_registered_client_can_be_described_for_consent() -> None:
        service, repository = _service()
        client = service.register({"redirect_uris": [REDIRECT]})
        authorize = OAuthAuthorizeService(
            clients=OAuthClientRegistry([repository]),
            codes=RedisAuthorizationCodeRepository(DictRedis()),
            settings=FakeTokenSettings(),
        )

        view = authorize.describe_client(client.client_id, REDIRECT)

        assert view.client_id == client.client_id
        assert view.display_name == "agent.example"

    @staticmethod
    @pytest.mark.parametrize(
        "method", [TokenEndpointAuthMethod.CLIENT_SECRET_BASIC, TokenEndpointAuthMethod.CLIENT_SECRET_POST]
    )
    def test_confidential_client_stores_only_the_secret_hash(
        method: TokenEndpointAuthMethod, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        install_rate_limit_store(monkeypatch)
        service, repository = _service()

        client = service.register({"redirect_uris": [REDIRECT], "token_endpoint_auth_method": method.value})

        assert client.client_secret
        assert repository.rows[client.client_id].client_secret_hash == sha256_hex(client.client_secret)
        assert repository.rows[client.client_id].kind == OAuthClientKind.CONFIDENTIAL
        authenticated = authenticate_client(
            OAuthClientRegistry([repository]),
            client_id=client.client_id,
            client_secret=client.client_secret,
            source_ip="127.0.0.1",
        )
        assert authenticated.client_id == client.client_id

    @staticmethod
    def test_two_registrations_get_different_ids() -> None:
        service, _ = _service()

        first = service.register({"redirect_uris": [REDIRECT]})
        second = service.register({"redirect_uris": [REDIRECT]})

        assert first.client_id != second.client_id

    @staticmethod
    def test_loopback_redirect_with_a_port_is_accepted() -> None:
        service, _ = _service()

        client = service.register({"redirect_uris": ["http://127.0.0.1:8123/cb"]})

        assert client.redirect_uris == ("http://127.0.0.1:8123/cb",)

    @staticmethod
    @pytest.mark.parametrize("name", [None, "", "   "])
    def test_missing_or_blank_name_falls_back_to_the_redirect_host(name: str | None) -> None:
        service, _ = _service()
        metadata: dict[str, object] = {"redirect_uris": [REDIRECT]}
        if name is not None:
            metadata["client_name"] = name

        assert service.register(metadata).client_name == "agent.example"

    @staticmethod
    def test_unknown_fields_are_ignored() -> None:
        service, _ = _service()

        client = service.register({"redirect_uris": [REDIRECT], "contacts": ["a@b.c"], "software_id": 7})

        assert client.client_id.startswith("dcr_")

    @staticmethod
    def test_authorization_code_only_is_allowed() -> None:
        service, _ = _service()

        client = service.register({"redirect_uris": [REDIRECT], "grant_types": ["authorization_code"]})

        assert client.grant_types == (GrantType.AUTHORIZATION_CODE,)

    @staticmethod
    def test_logo_uri_is_kept() -> None:
        service, _ = _service()

        client = service.register({"redirect_uris": [REDIRECT], "logo_uri": "https://agent.example/logo.png"})

        assert client.logo_uri == "https://agent.example/logo.png"


class TestRedirectUriCases:
    @staticmethod
    @pytest.mark.parametrize(
        "redirect_uris",
        [
            None,
            [],
            "https://agent.example/cb",
            ["http://example.com/cb"],
            ["https://agent.example/cb#frag"],
            [7],
            ["https://agent.example/" + "a" * 2048],
            [f"https://agent.example/{index}" for index in range(MAX_REDIRECT_URIS + 1)],
        ],
    )
    def test_bad_redirect_uris_are_rejected(redirect_uris: object) -> None:
        metadata: dict[str, object] = {} if redirect_uris is None else {"redirect_uris": redirect_uris}

        assert _error(metadata).code == RegistrationErrorCode.INVALID_REDIRECT_URI

    @staticmethod
    def test_ten_redirect_uris_are_accepted() -> None:
        service, _ = _service()

        client = service.register({"redirect_uris": [f"https://agent.example/{i}" for i in range(MAX_REDIRECT_URIS)]})

        assert len(client.redirect_uris) == MAX_REDIRECT_URIS


class TestInvalidMetadataCases:
    @staticmethod
    @pytest.mark.parametrize(
        "extra",
        [
            {"grant_types": ["urn:future:grant"]},
            {"grant_types": ["urn:ietf:params:oauth:grant-type:device_code"]},
            {"grant_types": ["refresh_token"]},
            {"grant_types": []},
            {"grant_types": "authorization_code"},
            {"grant_types": [1]},
            {"response_types": ["token"]},
            {"response_types": ["code", "token"]},
            {"response_types": "code"},
            {"token_endpoint_auth_method": "private_key_jwt"},
            {"token_endpoint_auth_method": 5},
            {"token_endpoint_auth_method": ["none"]},
            {"client_name": 5},
            {"client_name": "n" * 256},
            {"logo_uri": 5},
            {"logo_uri": "http://agent.example/logo.png"},
            {"logo_uri": "https://agent.example/" + "a" * 1024},
        ],
    )
    def test_bad_metadata_is_rejected(extra: dict[str, object]) -> None:
        error = _error({"redirect_uris": [REDIRECT], **extra})

        assert error.code == RegistrationErrorCode.INVALID_CLIENT_METADATA
        assert error.description
