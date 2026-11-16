from __future__ import annotations

import pytest

from libs.openapi_document import (
    OpenAPIDocument,
    OpenAPIStructureError,
    all_operations,
    array_at,
    lookup,
    object_at,
    operation_at,
    operations_of,
    parameters_by_name,
    parse_openapi_document,
    properties_of,
    request_body_schema,
    required_of,
    resolve_schema,
    response_content_types,
    response_schema,
    schema_refs,
    text_at,
    variants_of,
)


def _document() -> OpenAPIDocument:
    return parse_openapi_document(
        {
            "openapi": "3.0.2",
            "info": {"title": "Dify API", "version": "1.0.0"},
            "paths": {
                "/apps": {
                    "parameters": [{"in": "head", "name": "ignored-shared"}],
                    "get": {
                        "parameters": [{"in": "query", "name": "page", "required": True}],
                        "responses": {
                            "200": {
                                "content": {"application/json": {"schema": {"$ref": "#/components/schemas/AppList"}}}
                            }
                        },
                    },
                },
                "/apps/{app_id}/completion": {
                    "post": {
                        "requestBody": {
                            "content": {
                                "application/json": {"schema": {"$ref": "#/components/schemas/CompletionRequest"}},
                                "multipart/form-data": {"schema": {"type": "object"}},
                            }
                        },
                        "responses": {"201": {"content": {"text/event-stream": {"schema": {"type": "string"}}}}},
                    }
                },
            },
            "components": {
                "schemas": {
                    "AppList": {
                        "type": "object",
                        "required": ["data"],
                        "properties": {"data": {"type": "array", "items": {"$ref": "#/components/schemas/App"}}},
                    },
                    "App": {"type": "object", "additionalProperties": {"$ref": "#/components/schemas/AppMeta"}},
                    "AppMeta": {"type": "object", "anyOf": [{"$ref": "#/components/schemas/AppTag"}]},
                    "AppTag": {"type": "object"},
                    "CompletionRequest": {"type": "object", "properties": {"inputs": {"type": "object"}}},
                }
            },
        }
    )


class TestParseOpenAPIDocument:
    def test_collects_paths_and_schemas(self) -> None:
        document = _document()

        assert list(document.paths) == ["/apps", "/apps/{app_id}/completion"]
        assert set(document.schemas) == {
            "AppList",
            "App",
            "AppMeta",
            "AppTag",
            "CompletionRequest",
        }

    def test_drops_non_operation_members_of_a_path_item(self) -> None:
        path_item = _document().paths["/apps"]

        assert set(path_item) == {"get"}

    def test_rejects_paths_that_are_not_an_object(self) -> None:
        with pytest.raises(OpenAPIStructureError, match=r"expected paths to be an object, got list"):
            parse_openapi_document({"paths": [], "components": {}})

    def test_rejects_components_that_are_not_an_object(self) -> None:
        with pytest.raises(OpenAPIStructureError, match=r"expected components to be an object, got str"):
            parse_openapi_document({"paths": {}, "components": "nope"})

    def test_rejects_schemas_that_are_not_an_object(self) -> None:
        with pytest.raises(OpenAPIStructureError, match=r"expected components\.schemas to be an object"):
            parse_openapi_document({"paths": {}, "components": {"schemas": []}})

    def test_rejects_a_schema_that_is_not_an_object(self) -> None:
        with pytest.raises(OpenAPIStructureError, match=r"expected components\.schemas\[App\] to be an object"):
            parse_openapi_document({"paths": {}, "components": {"schemas": {"App": "nope"}}})

    def test_rejects_a_path_item_that_is_not_an_object(self) -> None:
        with pytest.raises(OpenAPIStructureError, match=r"expected paths\[/apps\] to be an object"):
            parse_openapi_document({"paths": {"/apps": []}, "components": {}})

    def test_tolerates_a_document_without_paths_or_components(self) -> None:
        document = parse_openapi_document({})

        assert document.paths == {}
        assert document.schemas == {}


class TestNavigation:
    def test_operation_at_returns_the_method_object(self) -> None:
        operation = operation_at(_document(), "/apps", "get")

        assert operation["responses"] is not None

    def test_operation_at_rejects_an_unknown_path(self) -> None:
        with pytest.raises(KeyError):
            operation_at(_document(), "/missing", "get")

    def test_operation_at_rejects_an_unknown_method(self) -> None:
        with pytest.raises(KeyError):
            operation_at(_document(), "/apps", "delete")

    def test_all_operations_pairs_each_path_with_each_method(self) -> None:
        triples = all_operations(_document())

        assert [(path, method) for path, method, _ in triples] == [
            ("/apps", "get"),
            ("/apps/{app_id}/completion", "post"),
        ]

    def test_operations_of_keeps_only_get(self) -> None:
        pairs = operations_of(_document())

        # The completion path only declares a POST, so it is not part of the GET view.
        assert [path for path, _ in pairs] == ["/apps"]

    def test_navigation_accepts_a_raw_mapping_too(self) -> None:
        pairs = operations_of({"paths": {"/raw": {"get": {}}}})

        assert [path for path, _ in pairs] == ["/raw"]


class TestPathAccessors:
    def test_lookup_walks_mixed_keys_and_falls_back(self) -> None:
        value = lookup(_document().raw, "paths", "/apps", "get")

        assert isinstance(value, dict)
        assert lookup(_document().raw, "paths", "/nope", default="fallback") == "fallback"

    def test_object_at_returns_a_mapping(self) -> None:
        assert "get" in object_at(_document().raw, "paths", "/apps")

    def test_object_at_rejects_a_non_mapping(self) -> None:
        raw = _document().raw
        with pytest.raises(OpenAPIStructureError, match=r"to be an object, got str"):
            object_at(raw, "paths", "/apps", "get", "responses", "200", "content", "application/json", "schema", "$ref")

    def test_array_at_returns_a_list(self) -> None:
        assert array_at(_document().raw, "paths", "/apps", "get", "parameters") == [
            {"in": "query", "name": "page", "required": True}
        ]

    def test_array_at_rejects_a_non_array(self) -> None:
        with pytest.raises(OpenAPIStructureError, match=r"to be an array"):
            array_at(_document().raw, "paths", "/apps", "get", "responses")

    def test_text_at_returns_a_string(self) -> None:
        assert text_at(_document().raw, "openapi") == "3.0.2"

    def test_text_at_rejects_a_non_string(self) -> None:
        with pytest.raises(OpenAPIStructureError, match=r"to be a string"):
            text_at(_document().raw, "info")


class TestComponentAccessors:
    def test_parameters_by_name_indexes_the_parameter_array(self) -> None:
        parameters = parameters_by_name(operation_at(_document(), "/apps", "get"))

        assert set(parameters) == {"page"}

    def test_parameters_by_name_skips_nameless_entries(self) -> None:
        assert parameters_by_name({"parameters": [{"in": "query"}]}) == {}

    def test_parameters_by_name_rejects_a_non_array(self) -> None:
        with pytest.raises(OpenAPIStructureError, match=r"to be an array"):
            parameters_by_name({"parameters": {"in": "query"}})

    def test_request_body_schema_reads_the_named_media_type(self) -> None:
        operation = operation_at(_document(), "/apps/{app_id}/completion", "post")

        assert request_body_schema(operation, "application/json") == {"$ref": "#/components/schemas/CompletionRequest"}

    def test_request_body_schema_rejects_an_absent_media_type(self) -> None:
        operation = operation_at(_document(), "/apps/{app_id}/completion", "post")

        with pytest.raises(OpenAPIStructureError, match=r"text/plain"):
            request_body_schema(operation, "text/plain")

    def test_response_content_types_lists_the_served_types(self) -> None:
        operation = operation_at(_document(), "/apps/{app_id}/completion", "post")

        assert response_content_types(operation, "201") == {"text/event-stream"}

    def test_response_content_types_rejects_an_absent_status(self) -> None:
        with pytest.raises(OpenAPIStructureError, match=r"404"):
            response_content_types(operation_at(_document(), "/apps", "get"), "404")

    def test_response_schema_walks_to_the_schema(self) -> None:
        operation = operation_at(_document(), "/apps", "get")

        assert response_schema(operation, "200", "application/json") == {"$ref": "#/components/schemas/AppList"}

    def test_properties_of_returns_the_property_map(self) -> None:
        schema = _document().schemas["CompletionRequest"]

        assert set(properties_of(schema)) == {"inputs"}

    def test_properties_of_defaults_to_empty(self) -> None:
        assert properties_of({"type": "object"}) == {}

    def test_required_of_returns_the_required_list(self) -> None:
        assert required_of(_document().schemas["AppList"]) == ["data"]

    def test_required_of_defaults_to_empty(self) -> None:
        assert required_of({"type": "object"}) == []

    def test_variants_of_reads_any_of_by_default(self) -> None:
        variants = variants_of(_document().schemas["AppMeta"])

        assert variants == [{"$ref": "#/components/schemas/AppTag"}]

    def test_variants_of_reads_a_named_field(self) -> None:
        variants = variants_of({"oneOf": [{"type": "string"}]}, "oneOf")

        assert variants == [{"type": "string"}]

    def test_variants_of_defaults_to_empty(self) -> None:
        assert variants_of({"type": "object"}) == []


class TestReferenceResolution:
    def test_resolve_schema_follows_a_local_reference(self) -> None:
        document = _document()
        schema = resolve_schema(document, {"$ref": "#/components/schemas/AppList"})

        assert set(properties_of(schema)) == {"data"}

    def test_resolve_schema_returns_a_non_reference_untouched(self) -> None:
        assert resolve_schema(_document(), {"type": "string"}) == {"type": "string"}

    def test_resolve_schema_rejects_an_unknown_reference(self) -> None:
        with pytest.raises(OpenAPIStructureError, match=r"components\.schemas\[\] to be an object"):
            resolve_schema(_document(), {"$ref": "#/components/schemas/Missing"})

    def test_schema_refs_collects_every_reference(self) -> None:
        refs = schema_refs({"$ref": "#/components/schemas/App", "items": [{"$ref": "#/components/schemas/AppTag"}]})

        # Names are returned bare: callers look them up in ``document.schemas``.
        assert refs == {"App", "AppTag"}

    def test_schema_refs_ignores_unrelated_strings(self) -> None:
        assert schema_refs({"type": "object", "title": "#/components/schemas/App"}) == set()
