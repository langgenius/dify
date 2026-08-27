import pytest
from pydantic import ValidationError

from controllers.openapi.auth.data import ExternalIdentity


def test_external_identity_frozen():
    ei = ExternalIdentity(email="a@b.com", issuer="idp")
    with pytest.raises(ValidationError):
        ei.email = "other@b.com"  # type: ignore[misc]


def test_external_identity_issuer_optional():
    ei = ExternalIdentity(email="a@b.com")
    assert ei.issuer is None
