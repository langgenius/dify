import importlib.util
import sys
from pathlib import Path

import pytest


def _load_lint_response_contracts_module():
    api_dir = Path(__file__).parents[3]
    script_path = api_dir / "dev" / "lint_response_contracts.py"
    spec = importlib.util.spec_from_file_location("lint_response_contracts", script_path)
    assert spec is not None
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _checks_for_source(tmp_path: Path, source: str):
    module = _load_lint_response_contracts_module()
    controller_path = tmp_path / "controllers" / "sample.py"
    controller_path.parent.mkdir()
    controller_path.write_text(source, encoding="utf-8")
    return module.checks_for_file(controller_path, tmp_path)


def test_no_body_status_with_body_is_mismatch_while_empty_body_is_valid(tmp_path: Path):
    checks = _checks_for_source(
        tmp_path,
        """
@ns.route("/bad")
class BadDeleteApi(Resource):
    @ns.response(204, "Deleted")
    def delete(self):
        return {"result": "success"}, 204


@ns.route("/ok")
class EmptyDeleteApi(Resource):
    @ns.response(204, "Deleted")
    def delete(self):
        return "", 204
""",
    )

    assert [(check.class_name, check.classification) for check in checks] == [
        ("BadDeleteApi", "mismatch"),
        ("EmptyDeleteApi", "valid"),
    ]
    assert "no-body response but returns raw_dict" in checks[0].reason


def test_variable_model_dump_is_refactorable_not_valid(tmp_path: Path):
    checks = _checks_for_source(
        tmp_path,
        """
from http import HTTPStatus


@ns.route("/annotations")
class AnnotationApi(Resource):
    @ns.response(HTTPStatus.CREATED, "Created", ns.models[AnnotationResponse.__name__])
    def post(self):
        if use_existing:
            response = AnnotationResponse.model_validate(existing, from_attributes=True)
        else:
            response = AnnotationResponse(id="new")
        return response.model_dump(mode="json"), HTTPStatus.CREATED
""",
    )

    assert len(checks) == 1
    assert checks[0].classification == "refactorable"
    assert checks[0].actual[0].status == 201
    assert checks[0].actual[0].kind == "model_dump_variable"
    assert "prefer dump_response" in checks[0].reason


def test_constructor_variable_model_dump_is_valid(tmp_path: Path):
    checks = _checks_for_source(
        tmp_path,
        """
@ns.route("/annotations")
class AnnotationApi(Resource):
    @ns.response(201, "Created", ns.models[AnnotationResponse.__name__])
    def post(self):
        response = AnnotationResponse(id="new", name=name)
        return response.model_dump(mode="json"), 201
""",
    )

    assert len(checks) == 1
    assert checks[0].classification == "valid"
    assert checks[0].actual[0].kind == "model"
    assert checks[0].actual[0].model == "AnnotationResponse"


def test_variable_model_dump_with_wrong_documented_schema_is_mismatch(tmp_path: Path):
    checks = _checks_for_source(
        tmp_path,
        """
@ns.route("/annotations")
class AnnotationApi(Resource):
    @ns.response(200, "OK", ns.models[DocumentedResponse.__name__])
    def get(self):
        response = ActualResponse.model_validate(data)
        return response.model_dump(mode="json"), 200
""",
    )

    assert len(checks) == 1
    assert checks[0].classification == "mismatch"
    assert "documents DocumentedResponse but returns ActualResponse" in checks[0].reason


def test_nested_returns_are_ignored_for_outer_control_flow(tmp_path: Path):
    checks = _checks_for_source(
        tmp_path,
        """
@ns.route("/stream")
class StreamApi(Resource):
    @ns.response(200, "OK", ns.models[StreamResponse.__name__])
    def get(self):
        def generate_events():
            return dump_response(WrongResponse, {"event": "nested"}), 200

        if finished:
            return dump_response(StreamResponse, {"event": "done"}), 200
        return dump_response(StreamResponse, {"event": "running"}), 200
""",
    )

    assert len(checks) == 1
    assert checks[0].classification == "valid"
    assert {actual.model for actual in checks[0].actual} == {"StreamResponse"}


def test_response_contract_ignore_comment_skips_route_method(tmp_path: Path):
    checks = _checks_for_source(
        tmp_path,
        """
@ns.route("/binary")
class BinaryApi(Resource):
    # response-contract:ignore binary response
    @ns.response(200, "Binary file")
    def get(self):
        return send_file(path)


# response-contract:ignore compact Flask response
@ns.route("/compact")
class CompactApi(Resource):
    def get(self):
        return make_response({"url": "https://example.com"})


@ns.route("/regular")
class RegularApi(Resource):
    @ns.response(200, "OK", ns.models[RegularResponse.__name__])
    def get(self):
        return dump_response(RegularResponse, {})
""",
    )

    assert len(checks) == 1
    assert checks[0].class_name == "RegularApi"
    assert checks[0].classification == "valid"


def test_main_is_report_only_by_default_for_mismatches(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    module = _load_lint_response_contracts_module()
    controller_path = tmp_path / "controllers" / "sample.py"
    controller_path.parent.mkdir()
    controller_path.write_text(
        """
@ns.route("/bad")
class BadDeleteApi(Resource):
    @ns.response(204, "Deleted")
    def delete(self):
        return {"result": "success"}, 204
""",
        encoding="utf-8",
    )

    monkeypatch.setattr(sys, "argv", ["lint_response_contracts.py", str(controller_path)])
    assert module.main() == 0

    monkeypatch.setattr(sys, "argv", ["lint_response_contracts.py", "--fail-on-mismatch", str(controller_path)])
    assert module.main() == 1


def test_main_hides_unknown_details_by_default(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys):
    module = _load_lint_response_contracts_module()
    controller_path = tmp_path / "controllers" / "sample.py"
    controller_path.parent.mkdir()
    controller_path.write_text(
        """
@ns.route("/items")
class ItemApi(Resource):
    @ns.response(200, "OK", ns.models[ItemResponse.__name__])
    def get(self):
        return dump_response(ItemResponse, item), status_code
""",
        encoding="utf-8",
    )

    monkeypatch.setattr(sys, "argv", ["lint_response_contracts.py", str(controller_path)])
    assert module.main() == 0
    default_output = capsys.readouterr().out
    assert "1 unknown" in default_output
    assert "UNKNOWN:" not in default_output

    monkeypatch.setattr(sys, "argv", ["lint_response_contracts.py", "--include-unknown", str(controller_path)])
    assert module.main() == 0
    include_unknown_output = capsys.readouterr().out
    assert "UNKNOWN:" in include_unknown_output
    assert "non-literal or unsupported status" in include_unknown_output


def test_class_level_route_and_response_docs_apply_to_methods(tmp_path: Path):
    checks = _checks_for_source(
        tmp_path,
        """
@ns.route(path="/items")
@ns.response(code=200, description="OK", model=ns.models[ItemListResponse.__name__])
class ItemListApi(Resource):
    def get(self):
        return dump_response(ItemListResponse, {"data": []}), 200
""",
    )

    assert len(checks) == 1
    assert checks[0].classification == "valid"
    assert checks[0].route == "/items"


def test_unknown_reassignment_prevents_variable_model_dump_inference(tmp_path: Path):
    checks = _checks_for_source(
        tmp_path,
        """
@ns.route("/items")
class ItemApi(Resource):
    @ns.response(200, "OK", ns.models[ItemResponse.__name__])
    def get(self):
        response = ItemResponse.model_validate(item)
        if refresh:
            response = load_response()
        return response.model_dump(mode="json"), 200
""",
    )

    assert len(checks) == 1
    assert checks[0].classification == "unknown"
    assert "returns unknown" in checks[0].reason


def test_non_literal_status_is_unknown_not_defaulted_to_200(tmp_path: Path):
    checks = _checks_for_source(
        tmp_path,
        """
@ns.route("/items")
class ItemApi(Resource):
    @ns.response(200, "OK", ns.models[ItemResponse.__name__])
    def get(self):
        return dump_response(ItemResponse, item), status_code
""",
    )

    assert len(checks) == 1
    assert checks[0].classification == "unknown"
    assert "non-literal or unsupported status" in checks[0].reason
