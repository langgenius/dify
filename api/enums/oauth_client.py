from enum import StrEnum


class OAuthClientKind(StrEnum):
    CONFIDENTIAL = "confidential"
    PUBLIC = "public"


class TokenEndpointAuthMethod(StrEnum):
    NONE = "none"
    CLIENT_SECRET_BASIC = "client_secret_basic"
    CLIENT_SECRET_POST = "client_secret_post"

    @property
    def kind(self) -> OAuthClientKind:
        if self == TokenEndpointAuthMethod.NONE:
            return OAuthClientKind.PUBLIC
        return OAuthClientKind.CONFIDENTIAL
