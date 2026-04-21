from __future__ import annotations

from typing import TYPE_CHECKING

from flask import Flask

if TYPE_CHECKING:
    from extensions.ext_login import DifyLoginManager


class DifyApp(Flask):
    """Flask application type with Dify-specific extension attributes."""

    login_manager: DifyLoginManager
