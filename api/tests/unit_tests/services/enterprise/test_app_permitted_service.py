from unittest.mock import patch

import pytest

from services.enterprise.app_permitted_service import PermittedAppsPage, list_permitted_apps
from services.errors.enterprise import EnterpriseAPIError

WRAPPER = "services.enterprise.app_permitted_service.EnterpriseService.WebAppAuth.list_externally_accessible_apps"


def test_list_permitted_apps_decodes_camelcase_response():
    fake_body = {
        "data": [{"appId": "a"}, {"appId": "b"}],
        "total": 2,
        "hasMore": False,
    }
    with patch(WRAPPER, return_value=fake_body) as m:
        page = list_permitted_apps(page=1, limit=10)

    assert isinstance(page, PermittedAppsPage)
    assert page.total == 2
    assert page.has_more is False
    assert page.app_ids == ["a", "b"]
    m.assert_called_once_with(page=1, limit=10, mode=None, name=None)


def test_list_permitted_apps_passes_filters_to_wrapper():
    fake_body = {"data": [], "total": 0, "hasMore": False}
    with patch(WRAPPER, return_value=fake_body) as m:
        list_permitted_apps(page=2, limit=5, mode="workflow", name="alpha")

    m.assert_called_once_with(page=2, limit=5, mode="workflow", name="alpha")


def test_list_permitted_apps_503_on_ee_error():
    with patch(WRAPPER, side_effect=EnterpriseAPIError("boom", status_code=500)):
        from werkzeug.exceptions import ServiceUnavailable

        with pytest.raises(ServiceUnavailable):
            list_permitted_apps(page=1, limit=10)


def test_list_permitted_apps_503_on_status_error():
    with patch(WRAPPER, side_effect=EnterpriseAPIError("bad key", status_code=401)):
        from werkzeug.exceptions import ServiceUnavailable

        with pytest.raises(ServiceUnavailable):
            list_permitted_apps(page=1, limit=10)


def test_list_permitted_apps_handles_empty_response():
    fake_body = {"data": [], "total": 0, "hasMore": False}
    with patch(WRAPPER, return_value=fake_body):
        page = list_permitted_apps(page=1, limit=10)
    assert page.app_ids == []
    assert page.total == 0
    assert page.has_more is False
