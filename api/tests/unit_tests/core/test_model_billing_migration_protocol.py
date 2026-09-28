import hashlib

import pytest

from core.model_billing_migration_protocol import canonical_hash
from services.entities.model_billing_migration import canonical_hash as application_canonical_hash


def test_domain_hash_preserves_shared_canonical_bytes_and_application_export():
    value = {"z": [True, {"money": "5000000", "name": "测试"}], "a": 7}
    encoded = '{"a":7,"z":[true,{"money":"5000000","name":"测试"}]}'.encode()
    assert canonical_hash(value) == "sha256:" + hashlib.sha256(encoded).hexdigest()
    assert canonical_hash is application_canonical_hash


@pytest.mark.parametrize("value", [{"amount": 1.0}, {"optional": None}, {"非ascii": "value"}])
def test_domain_hash_keeps_protocol_rejections(value):
    with pytest.raises(ValueError):
        canonical_hash(value)
