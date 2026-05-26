"""License gate for the /openapi/v1/permitted-external-apps* surface.

EE-only. CE deploys (``ENTERPRISE_ENABLED=false``) skip the gate entirely —
the EE blueprint chain is what gives CE deploys no callers on this surface
in practice, but the explicit short-circuit avoids any test/fixture that
flips the surface on without flipping the license.

Reuses ``FeatureService.get_system_features()`` so the license status
travels the same path as the console reads.

Companion to ``controllers.console.wraps.enterprise_license_required`` —
that one is for console (cookie-authed, force-logout 401). This one is
for bearer surface (token-authed, 403 ``license_required``).
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from functools import wraps

from werkzeug.exceptions import Forbidden

from configs import dify_config
from services.feature_service import FeatureService, LicenseStatus

logger = logging.getLogger(__name__)

_VALID_LICENSE_STATUSES: frozenset[LicenseStatus] = frozenset({LicenseStatus.ACTIVE, LicenseStatus.EXPIRING})


def license_required[**P, R](view: Callable[P, R]) -> Callable[P, R]:
    """Decorator form. Raises ``Forbidden('license_required')`` when the EE
    deployment has no valid license. No-op on CE (``ENTERPRISE_ENABLED=false``).
    """

    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs) -> R:
        if dify_config.ENTERPRISE_ENABLED and not _is_license_valid():
            raise Forbidden(description="license_required")
        return view(*args, **kwargs)

    return decorated


def _is_license_valid() -> bool:
    try:
        features = FeatureService.get_system_features()
    except Exception:
        logger.exception("license_gate: FeatureService.get_system_features failed")
        return False
    return features.license.status in _VALID_LICENSE_STATUSES
