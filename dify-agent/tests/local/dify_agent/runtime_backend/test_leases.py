from unittest.mock import AsyncMock, MagicMock

import pytest

from dify_agent.runtime_backend.leases import open_runtime_lease


@pytest.mark.anyio
async def test_runtime_lease_body_error_survives_release_error() -> None:
    lease = MagicMock()
    backend = MagicMock()
    backend.acquire = AsyncMock(return_value=lease)
    backend.release = AsyncMock(side_effect=RuntimeError("release failed"))

    with pytest.raises(ValueError, match="body failed"):
        async with open_runtime_lease(backend, "binding-ref"):
            raise ValueError("body failed")

    backend.release.assert_awaited_once_with(lease)


@pytest.mark.anyio
async def test_runtime_lease_release_error_propagates_after_successful_body() -> None:
    lease = MagicMock()
    backend = MagicMock()
    backend.acquire = AsyncMock(return_value=lease)
    backend.release = AsyncMock(side_effect=RuntimeError("release failed"))

    with pytest.raises(RuntimeError, match="release failed"):
        async with open_runtime_lease(backend, "binding-ref"):
            pass

    backend.release.assert_awaited_once_with(lease)
