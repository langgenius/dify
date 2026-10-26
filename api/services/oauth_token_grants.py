"""Grant handlers registered into ``OAuthTokenService``."""

from collections.abc import Mapping

from services.oauth_token_contracts import GrantType
from services.oauth_token_service import GrantHandler


def build_grant_handlers() -> Mapping[GrantType, GrantHandler]:
    return {}
