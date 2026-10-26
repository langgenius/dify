import importlib

import pytest


@pytest.mark.parametrize(
    "module_name",
    [
        "services.rag_pipeline.pipeline_template",
        "services.rag_pipeline.pipeline_template.built_in",
        "services.rag_pipeline.pipeline_template.customized",
        "services.rag_pipeline.pipeline_template.database",
        "services.rag_pipeline.pipeline_template.remote",
    ],
)
def test_package_imports(module_name: str) -> None:
    module = importlib.import_module(module_name)

    assert module is not None
