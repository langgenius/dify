"""Tests for the KnowledgeFS OpenAPI operation-slice generator."""

from __future__ import annotations

import importlib.util
import sys
from copy import deepcopy
from pathlib import Path

import pytest


def _load_generator_module():
    api_dir = Path(__file__).resolve().parents[3]
    script_path = api_dir / "dev" / "generate_knowledge_fs_client.py"
    spec = importlib.util.spec_from_file_location("generate_knowledge_fs_client", script_path)
    assert spec
    assert spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)  # type: ignore[attr-defined]
    return module


def _source_contract() -> dict[str, object]:
    error_response = {
        "type": "object",
        "properties": {"error": {"type": "string"}},
        "required": ["error"],
    }
    return {
        "openapi": "3.1.0",
        "info": {"title": "Knowledge Platform API", "version": "0.1.0"},
        "security": [{"bearerAuth": []}],
        "paths": {
            "/health": {"get": {"operationId": "getHealth", "responses": {"200": {"description": "ok"}}}},
            "/knowledge-spaces": {
                "parameters": [
                    {
                        "in": "header",
                        "name": "X-Request-ID",
                        "required": False,
                        "schema": {"type": "string"},
                    }
                ],
                "get": {
                    "operationId": "listKnowledgeSpaces",
                    "responses": {
                        "200": {
                            "description": "ok",
                            "content": {
                                "application/json": {"schema": {"$ref": "#/components/schemas/KnowledgeSpaceList"}}
                            },
                        },
                        "400": {
                            "description": "bad request",
                            "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}},
                        },
                    },
                },
                "post": {
                    "operationId": "createKnowledgeSpace",
                    "requestBody": {
                        "content": {
                            "application/json": {"schema": {"$ref": "#/components/schemas/CreateKnowledgeSpace"}}
                        }
                    },
                    "responses": {
                        "201": {
                            "description": "created",
                            "content": {
                                "application/json": {"schema": {"$ref": "#/components/schemas/KnowledgeSpace"}}
                            },
                        }
                    },
                },
            },
        },
        "components": {
            "securitySchemes": {"bearerAuth": {"type": "http", "scheme": "bearer"}},
            "schemas": {
                "CreateKnowledgeSpace": {"type": "object"},
                "ErrorResponse": error_response,
                "KnowledgeSpace": {"type": "object"},
                "KnowledgeSpaceList": {
                    "type": "object",
                    "properties": {
                        "items": {
                            "type": "array",
                            "items": {"$ref": "#/components/schemas/KnowledgeSpace"},
                        }
                    },
                },
                "Unused": {"type": "object"},
            },
        },
    }


def test_project_contract_keeps_only_selected_operations_and_transitive_schemas() -> None:
    module = _load_generator_module()

    projected = module.project_contract(_source_contract(), source_sha256="full-spec-sha")

    assert set(projected["paths"]) == {"/knowledge-spaces"}
    assert set(projected["paths"]["/knowledge-spaces"]) == {"get", "parameters", "post"}
    assert set(projected["components"]["schemas"]) == {
        "CreateKnowledgeSpace",
        "ErrorResponse",
        "KnowledgeSpace",
        "KnowledgeSpaceList",
    }
    assert projected["components"]["securitySchemes"] == {"bearerAuth": {"type": "http", "scheme": "bearer"}}
    assert projected["x-dify-source"]["sha256"] == "full-spec-sha"
    assert projected["x-dify-source"]["operations"] == [
        "listKnowledgeSpaces",
        "createKnowledgeSpace",
    ]


def test_project_contract_rejects_missing_stable_operation_id() -> None:
    module = _load_generator_module()
    source = deepcopy(_source_contract())
    del source["paths"]["/knowledge-spaces"]["post"]["operationId"]

    with pytest.raises(ValueError, match="createKnowledgeSpace"):
        module.project_contract(source, source_sha256="full-spec-sha")


def test_project_contract_rejects_selected_operation_without_bearer_authentication() -> None:
    module = _load_generator_module()
    source = deepcopy(_source_contract())
    source["paths"]["/knowledge-spaces"]["get"]["security"] = []

    with pytest.raises(ValueError, match="bearerAuth"):
        module.project_contract(source, source_sha256="full-spec-sha")


@pytest.mark.parametrize(
    "security",
    [
        [{"bearerAuth": [], "mutualTls": []}],
        [{"bearerAuth": []}, {"apiKey": []}],
        [{"bearerAuth": ["knowledge-spaces:read"]}],
    ],
)
def test_project_contract_rejects_authentication_not_satisfied_by_bearer_alone(
    security: list[dict[str, list[str]]],
) -> None:
    module = _load_generator_module()
    source = deepcopy(_source_contract())
    source["paths"]["/knowledge-spaces"]["get"]["security"] = security

    with pytest.raises(ValueError, match="bearerAuth"):
        module.project_contract(source, source_sha256="full-spec-sha")
