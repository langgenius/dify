from collections.abc import Callable
from unittest.mock import Mock

import pytest
from pytest_mock import MockerFixture


@pytest.fixture
def patch_session_factory(mocker: MockerFixture) -> Callable[[str, Mock], Mock]:
    def _patch(module_path: str, session_mock: Mock) -> Mock:
        session_context = mocker.MagicMock()
        session_context.__enter__.return_value = session_mock
        session_context.__exit__.return_value = None
        session_maker = mocker.Mock(return_value=session_context)
        mocker.patch(f"{module_path}.session_factory.get_session_maker", return_value=session_maker)
        return session_maker

    return _patch
