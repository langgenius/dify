import importlib

import pytest

import constants
from configs import dify_config


@pytest.mark.parametrize("etl_type", ["SelfHosted", "Unstructured"])
def test_document_extensions_include_odt_for_document_etl_modes(monkeypatch: pytest.MonkeyPatch, etl_type: str) -> None:
    original_etl_type = dify_config.ETL_TYPE
    original_unstructured_api_url = dify_config.UNSTRUCTURED_API_URL

    try:
        monkeypatch.setattr(dify_config, "ETL_TYPE", etl_type)
        monkeypatch.setattr(dify_config, "UNSTRUCTURED_API_URL", None)

        reloaded_constants = importlib.reload(constants)

        assert "odt" in reloaded_constants.DOCUMENT_EXTENSIONS
        assert "ODT" in reloaded_constants.DOCUMENT_EXTENSIONS
    finally:
        monkeypatch.setattr(dify_config, "ETL_TYPE", original_etl_type)
        monkeypatch.setattr(dify_config, "UNSTRUCTURED_API_URL", original_unstructured_api_url)
        importlib.reload(constants)
