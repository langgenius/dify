from types import SimpleNamespace

import pytest
from werkzeug.exceptions import Forbidden

from controllers.console.resource_access_token import _require_owner
from models.account import TenantAccountRole


def test_require_owner_allows_owner():
    _require_owner(SimpleNamespace(current_role=TenantAccountRole.OWNER))


def test_require_owner_rejects_non_owner():
    with pytest.raises(Forbidden):
        _require_owner(SimpleNamespace(current_role=TenantAccountRole.ADMIN))
