import pytest

from libs import device_flow_security
from libs import jws as jws_mod


def test_verify_approval_grant_rejects_missing_claim() -> None:
    keyset = jws_mod.KeySet.from_entries(
        {"key-1": b"test-secret-key-that-is-at-least-32-bytes"},
        active_kid="key-1",
    )
    incomplete = jws_mod.sign(
        keyset,
        payload={
            "subject_email": "external@example.com",
            "subject_issuer": "https://idp.example",
            "user_code": "ABCD-EFGH",
            "nonce": "nonce-1",
        },
        aud=jws_mod.AUD_APPROVAL_GRANT,
        ttl_seconds=60,
    )

    with pytest.raises(jws_mod.VerifyError):
        device_flow_security.verify_approval_grant(keyset, incomplete)
