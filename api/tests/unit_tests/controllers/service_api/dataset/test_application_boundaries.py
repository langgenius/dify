"""Guard migrated Service API dataset controllers against architecture regressions."""

import ast
from pathlib import Path

import pytest

_ENDPOINT_METHODS = {"get", "post", "put", "patch", "delete"}

# Controllers may import transport schemas, domain errors and shared value objects.  They
# must not reach through the application boundary to persistence or the implementations
# which the knowledge composition root owns.
_FORBIDDEN_IMPORTS = (
    "sqlalchemy",
    "repositories",
    "extensions.ext_database",
    "models.engine",
    "controllers.common.session",
    "controllers.console.app.wraps",
    "controllers.service_api.wraps",
    "configs",
    "services.enterprise",
    "services.feature_service",
    "services.file_service",
    "services.hit_testing_service",
    "services.knowledge.dataset_read_service",
    "services.knowledge.summaries.adapters",
    "services.rag_pipeline.pipeline_generate_service",
    "services.rag_pipeline.rag_pipeline",
    "services.tag_service",
    "core.app.apps.pipeline.pipeline_generator",
    "core.plugin.impl.model_runtime_factory",
    "werkzeug",
)
_ORM_MODEL_NAMES = {
    "Account",
    "Dataset",
    "Document",
    "DocumentSegment",
    "Pipeline",
    "Tenant",
    "UploadFile",
}
_FORBIDDEN_NAMES = {
    "FeatureService",
    "DeploymentEdition",
    "current_account_with_tenant",
    "current_user",
    "db",
    "dify_config",
    "with_session",
}
_OLD_ADMISSION_DECORATORS = {
    "cloud_edition_billing_knowledge_limit_check",
    "cloud_edition_billing_rate_limit_check",
    "cloud_edition_billing_resource_check",
    "edit_permission_required",
    "validate_dataset_token",
    "with_session",
}
_DEPENDENCY_SUFFIXES = ("Adapter", "Gateway", "Manager", "Repository", "Service")
_PYDANTIC_MODEL_BUILDING_IMPORTS = {
    "BaseModel",
    "Field",
    "RootModel",
    "field_validator",
    "model_validator",
    "root_validator",
    "validator",
}
_TRANSPORT_MODEL_SUFFIXES = ("Payload", "Query", "Response")
_SHARED_SCHEMA_PATHS = (
    "fields/workflow_fields.py",
    "fields/types.py",
)


def _imported_modules(node: ast.Import | ast.ImportFrom) -> list[str]:
    if isinstance(node, ast.ImportFrom):
        return [node.module or ""]
    return [alias.name for alias in node.names]


def _endpoint_classes(tree: ast.Module) -> list[tuple[ast.ClassDef, ast.FunctionDef | ast.AsyncFunctionDef]]:
    return [
        (resource, method)
        for resource in tree.body
        if isinstance(resource, ast.ClassDef)
        for method in resource.body
        if isinstance(method, (ast.FunctionDef, ast.AsyncFunctionDef)) and method.name in _ENDPOINT_METHODS
    ]


def _calls(node: ast.AST, name: str) -> bool:
    return any(isinstance(child, ast.Call) and ast.unparse(child.func) == name for child in ast.walk(node))


def _import_bindings(tree: ast.Module) -> dict[str, tuple[str, str]]:
    """Map locally bound import names to their source module and symbol."""

    bindings: dict[str, tuple[str, str]] = {}
    for node in ast.walk(tree):
        if not isinstance(node, ast.ImportFrom) or node.module is None:
            continue
        for alias in node.names:
            bindings[alias.asname or alias.name] = (node.module, alias.name)
    return bindings


def _base_name(base: ast.expr) -> str | None:
    """Return the root name of a direct base, including parameterized bases."""

    if isinstance(base, ast.Subscript):
        return _base_name(base.value)
    if isinstance(base, ast.Name):
        return base.id
    return None


def _is_imported_transport_model(class_node: ast.ClassDef, import_bindings: dict[str, tuple[str, str]]) -> bool:
    """Detect schema subclasses even when their imported base has a local alias."""

    for base in class_node.bases:
        base_name = _base_name(base)
        if base_name is None or base_name not in import_bindings:
            continue
        module, imported_name = import_bindings[base_name]
        if module == "pydantic" and imported_name in {"BaseModel", "RootModel"}:
            return True
        if module == "fields" or module.startswith("fields."):
            return True
    return False


@pytest.mark.parametrize(
    ("filename", "endpoint_count"),
    [
        ("dataset.py", 13),
        ("document.py", 13),
        ("hit_testing.py", 1),
        ("metadata.py", 7),
        ("segment.py", 9),
        ("rag_pipeline/rag_pipeline_workflow.py", 4),
    ],
)
def test_dataset_controllers_use_admission_and_application_services(filename: str, endpoint_count: int) -> None:
    root = Path(__file__).resolve().parents[5]
    tree = ast.parse((root / "controllers/service_api/dataset" / filename).read_text())

    imports = [node for node in ast.walk(tree) if isinstance(node, (ast.Import, ast.ImportFrom))]
    for node in imports:
        for module in _imported_modules(node):
            assert not any(module == name or module.startswith(name + ".") for name in _FORBIDDEN_IMPORTS), module

        if isinstance(node, ast.Import):
            assert all(not alias.name.startswith("models") for alias in node.names)
            assert all(alias.name != "services" for alias in node.names)
        elif (node.module or "") == "models" or (node.module or "").startswith("models."):
            imported_names = {alias.name for alias in node.names}
            forbidden_models = imported_names.intersection(_ORM_MODEL_NAMES)
            assert not forbidden_models, sorted(forbidden_models)

    imported_admission = any(
        isinstance(node, ast.ImportFrom)
        and node.module == "controllers.service_api.flask_admission"
        and any(alias.name == "DatasetApiResource" for alias in node.names)
        for node in imports
    )
    assert imported_admission, filename

    for node in ast.walk(tree):
        if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            assert not node.name.startswith("Legacy"), node.name
        if isinstance(node, ast.Name):
            assert node.id not in _FORBIDDEN_NAMES, node.id
        if isinstance(node, ast.Attribute):
            assert not ast.unparse(node).startswith("db.session"), ast.unparse(node)
        if isinstance(node, ast.Call):
            callee = ast.unparse(node.func).rsplit(".", 1)[-1]
            assert not callee.endswith(_DEPENDENCY_SUFFIXES), callee

    endpoints = _endpoint_classes(tree)
    assert len(endpoints) == endpoint_count
    for resource, endpoint in endpoints:
        assert "DatasetApiResource" in {ast.unparse(base) for base in resource.bases}, resource.name

        arguments = endpoint.args.posonlyargs + endpoint.args.args + endpoint.args.kwonlyargs
        request_context = next(
            (
                argument
                for argument in arguments
                if argument.annotation is not None
                and ast.unparse(argument.annotation).rsplit(".", 1)[-1] == "RequestContext"
            ),
            None,
        )
        assert request_context is not None, f"{resource.name}.{endpoint.name}"
        assert not {argument.arg for argument in arguments}.intersection({"current_user", "session", "tenant_id"})

        decorator_names = {
            ast.unparse(decorator.func) for decorator in endpoint.decorator_list if isinstance(decorator, ast.Call)
        }
        assert not decorator_names.intersection(_OLD_ADMISSION_DECORATORS), sorted(
            decorator_names.intersection(_OLD_ADMISSION_DECORATORS)
        )
        admission_decorators = {name for name in decorator_names if name.rsplit(".", 1)[-1].endswith("_admission")}
        assert admission_decorators.issubset({"dataset_admission"}), sorted(admission_decorators)

        # Deprecated route aliases can delegate to the canonical endpoint. All canonical
        # handlers must cross the composition root explicitly.
        if not resource.name.startswith("Deprecated"):
            assert _calls(endpoint, "application_services"), f"{resource.name}.{endpoint.name}"


@pytest.mark.parametrize(
    "filename",
    [
        "dataset.py",
        "document.py",
        "hit_testing.py",
        "metadata.py",
        "segment.py",
        "rag_pipeline/rag_pipeline_workflow.py",
    ],
)
def test_dataset_controllers_do_not_own_transport_models(filename: str) -> None:
    root = Path(__file__).resolve().parents[5]
    tree = ast.parse((root / "controllers/service_api/dataset" / filename).read_text())
    import_bindings = _import_bindings(tree)

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            assert all(alias.name != "pydantic" and not alias.name.startswith("pydantic.") for alias in node.names), (
                filename
            )
        elif (
            isinstance(node, ast.ImportFrom)
            and node.module is not None
            and (node.module == "pydantic" or node.module.startswith("pydantic."))
        ):
            forbidden = {alias.name for alias in node.names}.intersection(_PYDANTIC_MODEL_BUILDING_IMPORTS)
            assert not forbidden, f"{filename}: {sorted(forbidden)}"

    local_models = [
        node.name
        for node in tree.body
        if isinstance(node, ast.ClassDef)
        and (node.name.endswith(_TRANSPORT_MODEL_SUFFIXES) or _is_imported_transport_model(node, import_bindings))
    ]
    assert not local_models, f"{filename}: {local_models}"


def test_service_api_field_modules_do_not_depend_on_controllers() -> None:
    root = Path(__file__).resolve().parents[5]
    schema_paths = sorted((root / "fields/service_api").rglob("*.py"))
    schema_paths.extend(root / relative_path for relative_path in _SHARED_SCHEMA_PATHS)

    for schema_path in schema_paths:
        tree = ast.parse(schema_path.read_text())
        controller_imports = {
            module
            for node in ast.walk(tree)
            if isinstance(node, (ast.Import, ast.ImportFrom))
            for module in _imported_modules(node)
            if module == "controllers" or module.startswith("controllers.")
        }
        assert not controller_imports, f"{schema_path.relative_to(root)}: {sorted(controller_imports)}"
