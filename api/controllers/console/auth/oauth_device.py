"""Placeholder. Legacy /console/api/oauth/device/{approve,deny} mounts
are registered from the canonical openapi handlers in
controllers/openapi/oauth_device/{approve,deny}.py. This file stays
on disk only so controllers/console/__init__.py's
`from .auth import (... oauth_device, ...)` keeps working until
Phase F retires the legacy paths and prunes that import.
"""
from __future__ import annotations
