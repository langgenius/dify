from __future__ import annotations

from collections.abc import Callable
from unittest.mock import MagicMock, Mock

import pytest
from flask import Flask, g


@pytest.fixture
def attach_login_manager() -> Callable[[Flask, object], None]:
    def _attach(app: Flask, user: object) -> None:
        if isinstance(user, Mock):
            user.is_authenticated = True

        login_manager = MagicMock()
        login_manager._load_user.side_effect = lambda: setattr(g, "_login_user", user)
        login_manager.unauthorized.return_value = ("Unauthorized", 401)
        app.login_manager = login_manager

    return _attach
