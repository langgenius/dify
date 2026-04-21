"""Generate a backend env reference from the authoritative config model.

This module derives backend env input metadata from ``DifyConfig`` instead of
grepping individual files. The exported reference intentionally captures only
code-defined semantics and fallback defaults; it does not attempt to represent
deployment defaults or runtime-effective values.
"""

from __future__ import annotations

import inspect
import json
import logging
import re
from collections import defaultdict
from enum import Enum
from pathlib import Path
from types import UnionType
from typing import Any, TypedDict, get_args, get_origin

from pydantic import AliasChoices, BaseModel
from pydantic.fields import FieldInfo
from pydantic_settings import BaseSettings

from .app_config import DifyConfig

_REPO_ROOT = Path(__file__).resolve().parents[2]
_API_ROOT = Path(__file__).resolve().parents[1]
_DOCS_ROOT = _API_ROOT / "docs"
_JSON_OUTPUT = _DOCS_ROOT / "backend-env.reference.json"
_MARKDOWN_OUTPUT = _DOCS_ROOT / "backend-env.reference.md"
_SENSITIVE_SUFFIXES = (
    "_PASSWORD",
    "_SECRET",
    "_TOKEN",
    "_API_KEY",
    "_ACCESS_KEY",
    "_SECRET_KEY",
    "_PRIVATE_KEY",
)
logger = logging.getLogger(__name__)

_DESCRIPTION_REWRITES = {
    "Duration in minutes for which a account deletion token remains valid": (
        "Duration in minutes for which an account deletion token remains valid."
    ),
    "whether to enable education identity": "Whether to enable education identity.",
    (
        "Granularity for async workflow scheduler, sometime, few users could block the queue "
        "due to some time-consuming tasks, to avoid this, workflow can be suspended if needed, "
        "to achievethis, a time-based checker is required, every granularity seconds, "
        "the checker will check the workflow queue and suspend the workflow"
    ): (
        "Granularity for the async workflow scheduler. Some users could block the queue with "
        "time-consuming tasks, so workflows can be suspended when needed. A time-based checker "
        "runs every granularity seconds to inspect the queue and suspend workflows."
    ),
    (
        "Base URL for file preview or download, used for frontend display and multi-model "
        "inputsUrl is signed and has expiration time."
    ): (
        "Base URL for file preview or download, used for frontend display and multi-model "
        "inputs. The URL is signed and has an expiration time."
    ),
}


class BackendEnvVariableReference(TypedDict):
    name: str
    accepted_names: list[str]
    group: str
    type: str
    description: str
    code_default: Any | None
    required: bool
    applies_when: str | None


class BackendEnvReference(TypedDict):
    schema_version: str
    artifact_policy: str
    authority: dict[str, str]
    resolution: dict[str, list[str]]
    variables: list[BackendEnvVariableReference]


def _config_classes() -> list[type[BaseSettings]]:
    return [
        cls
        for cls in DifyConfig.__mro__[1:]
        if inspect.isclass(cls)
        and issubclass(cls, BaseSettings)
        and cls is not BaseSettings
        and cls.__module__.startswith("configs.")
    ]


def _owner_class_for_field(field_name: str) -> type[BaseSettings] | None:
    for cls in _config_classes():
        if field_name in getattr(cls, "__annotations__", {}):
            return cls
    return None


def _normalize_name(name: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "-", name).replace("_", "-").lower()


def _group_for_owner(owner: type[BaseSettings]) -> str:
    module_parts = owner.__module__.removeprefix("configs.").split(".")
    if module_parts[-1].endswith("_config"):
        module_parts = module_parts[:-1]
    return ".".join([*module_parts, _normalize_name(owner.__name__.removesuffix("Config"))])


def _accepted_names(field_name: str, field_info: FieldInfo) -> list[str]:
    alias = field_info.validation_alias
    if isinstance(alias, AliasChoices):
        names = [str(choice) for choice in alias.choices]
    elif isinstance(alias, str):
        names = [alias]
    else:
        names = [field_name]

    if field_name not in names:
        names.append(field_name)
    return names


def _type_name(annotation: Any) -> str:
    origin = get_origin(annotation)
    if origin is None:
        if annotation in {str, Any}:
            return "string"
        if annotation is bool:
            return "boolean"
        if annotation is int:
            return "integer"
        if annotation is float:
            return "float"
        if annotation is type(None):
            return "null"
        if inspect.isclass(annotation):
            if issubclass(annotation, Enum):
                return "enum"
            if issubclass(annotation, str):
                return "string"
            if issubclass(annotation, bool):
                return "boolean"
            if issubclass(annotation, int):
                return "integer"
            if issubclass(annotation, float):
                return "float"
        return getattr(annotation, "__name__", str(annotation))

    if origin is UnionType or str(origin).endswith("Union"):
        args = [arg for arg in get_args(annotation) if arg is not type(None)]
        rendered = " | ".join(_type_name(arg) for arg in args) if args else "null"
        if len(args) != len(get_args(annotation)):
            return f"{rendered} | null"
        return rendered

    if str(origin).endswith("Literal"):
        values = ", ".join(repr(value) for value in get_args(annotation))
        return f"literal[{values}]"

    if str(origin).endswith("Annotated"):
        args = get_args(annotation)
        return _type_name(args[0]) if args else "annotated"

    if origin in {list, tuple, set}:
        args = get_args(annotation)
        item_type = _type_name(args[0]) if args else "any"
        return f"{origin.__name__}[{item_type}]"

    return str(annotation)


def _serialize_default(value: Any) -> Any | None:
    if value is None:
        return None
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (list, tuple)):
        return [_serialize_default(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _serialize_default(item) for key, item in value.items()}
    return str(value)


def _markdown_cell(value: Any | None) -> str:
    if value is None:
        return ""

    text = str(value)
    normalized = " ".join(text.split())
    return normalized.replace("|", "\\|")


def _markdown_code_cell(value: Any | None, *, empty: str = "") -> str:
    text = _markdown_cell(value)
    if not text:
        return empty
    return f"`{text.replace('`', '\\`')}`"


def _render_code_default(value: Any | None) -> str:
    if value is None:
        return _markdown_code_cell(json.dumps("", ensure_ascii=False))

    if isinstance(value, str):
        return _markdown_code_cell(json.dumps(" ".join(value.split()), ensure_ascii=False))

    return _markdown_code_cell(json.dumps(value, ensure_ascii=False))


def _normalize_description(description: str) -> str:
    normalized = " ".join(description.split())
    if not normalized:
        return ""

    rewritten = _DESCRIPTION_REWRITES.get(normalized, normalized)
    rewritten = re.sub(r"(?<=[.!?])(?=[A-Z])", " ", rewritten)
    rewritten = re.sub(r"(?<=\w),(?=[A-Za-z])", ", ", rewritten)
    rewritten = re.sub(r"(?<=:)(?=https?://)", " ", rewritten)
    rewritten = re.sub(r"(?<=\w)\((?=e\.g\.,)", " (", rewritten)
    return rewritten


def _render_group_applicability_notes(variables: list[BackendEnvVariableReference]) -> list[str]:
    applies_when_groups: dict[str, list[str]] = defaultdict(list)
    for variable in variables:
        applies_when = variable["applies_when"]
        if applies_when:
            applies_when_groups[applies_when].append(variable["name"])

    if not applies_when_groups:
        return []

    if len(applies_when_groups) == 1 and len(next(iter(applies_when_groups.values()))) == len(variables):
        applies_when = next(iter(applies_when_groups))
        return [f"> Applies when: {_markdown_code_cell(applies_when)}", ""]

    lines = ["Applies when:"]
    for applies_when, names in sorted(applies_when_groups.items()):
        joined_names = ", ".join(f"`{name}`" for name in sorted(names))
        lines.append(f"- {joined_names}: {_markdown_code_cell(applies_when)}")
    lines.append("")
    return lines


def _provider_applies_when(owner: type[BaseSettings], field_name: str) -> str | None:
    source_file = Path(inspect.getsourcefile(owner) or "")
    source_name = source_file.name

    storage_map = {
        "amazon_s3_storage_config.py": "STORAGE_TYPE=s3",
        "aliyun_oss_storage_config.py": "STORAGE_TYPE=aliyun-oss",
        "azure_blob_storage_config.py": "STORAGE_TYPE=azure-blob",
        "baidu_obs_storage_config.py": "STORAGE_TYPE=baidu-obs",
        "clickzetta_volume_storage_config.py": "STORAGE_TYPE=clickzetta-volume",
        "google_cloud_storage_config.py": "STORAGE_TYPE=google-storage",
        "huawei_obs_storage_config.py": "STORAGE_TYPE=huawei-obs",
        "oci_storage_config.py": "STORAGE_TYPE=oci-storage",
        "opendal_storage_config.py": "STORAGE_TYPE=opendal",
        "supabase_storage_config.py": "STORAGE_TYPE=supabase",
        "tencent_cos_storage_config.py": "STORAGE_TYPE=tencent-cos",
        "volcengine_tos_storage_config.py": "STORAGE_TYPE=volcengine-tos",
    }
    if field_name == "STORAGE_LOCAL_PATH":
        return "STORAGE_TYPE=local"
    if source_name in storage_map:
        return storage_map[source_name]

    vector_map = {
        "analyticdb_config.py": "VECTOR_STORE=analyticdb",
        "baidu_vector_config.py": "VECTOR_STORE=baidu_vector",
        "chroma_config.py": "VECTOR_STORE=chroma",
        "clickzetta_config.py": "VECTOR_STORE=clickzetta",
        "couchbase_config.py": "VECTOR_STORE=couchbase",
        "elasticsearch_config.py": "VECTOR_STORE=elasticsearch",
        "hologres_config.py": "VECTOR_STORE=hologres",
        "huawei_cloud_config.py": "VECTOR_STORE=huawei-cloud",
        "iris_config.py": "VECTOR_STORE=iris",
        "lindorm_config.py": "VECTOR_STORE=lindorm",
        "matrixone_config.py": "VECTOR_STORE=matrixone",
        "milvus_config.py": "VECTOR_STORE=milvus",
        "myscale_config.py": "VECTOR_STORE=myscale",
        "oceanbase_config.py": "VECTOR_STORE=oceanbase",
        "opengauss_config.py": "VECTOR_STORE=opengauss",
        "opensearch_config.py": "VECTOR_STORE=opensearch",
        "oracle_config.py": "VECTOR_STORE=oracle",
        "pgvector_config.py": "VECTOR_STORE=pgvector",
        "pgvectors_config.py": "VECTOR_STORE=pgvectors",
        "qdrant_config.py": "VECTOR_STORE=qdrant",
        "relyt_config.py": "VECTOR_STORE=relyt",
        "tablestore_config.py": "VECTOR_STORE=tablestore",
        "tencent_vector_config.py": "VECTOR_STORE=tencent",
        "tidb_on_qdrant_config.py": "VECTOR_STORE=tidb_on_qdrant",
        "tidb_vector_config.py": "VECTOR_STORE=tidb_vector",
        "upstash_config.py": "VECTOR_STORE=upstash",
        "vastbase_vector_config.py": "VECTOR_STORE=vastbase",
        "vikingdb_config.py": "VECTOR_STORE=vikingdb",
        "weaviate_config.py": "VECTOR_STORE=weaviate",
        "alibabacloud_mysql_config.py": "VECTOR_STORE=alibabacloud-mysql",
    }
    applies_when = vector_map.get(source_name)
    if (
        applies_when
        and source_name == "elasticsearch_config.py"
        and ("CLOUD" in field_name or field_name in {"ELASTICSEARCH_API_KEY", "ELASTICSEARCH_CA_CERTS"})
    ):
        return f"{applies_when}; ELASTICSEARCH_USE_CLOUD=true"
    return applies_when


def build_backend_env_reference() -> BackendEnvReference:
    variables: list[BackendEnvVariableReference] = []

    for field_name, field_info in sorted(DifyConfig.model_fields.items()):
        if not field_name.isupper():
            continue

        owner = _owner_class_for_field(field_name)
        if owner is None:
            continue

        variables.append(
            {
                "name": field_name,
                "accepted_names": _accepted_names(field_name, field_info),
                "group": _group_for_owner(owner),
                "type": _type_name(field_info.annotation),
                "description": field_info.description or "",
                "code_default": None if field_info.is_required() else _serialize_default(field_info.default),
                "required": field_info.is_required(),
                "applies_when": _provider_applies_when(owner, field_name),
            }
        )

    return {
        "schema_version": "1",
        "artifact_policy": "committed-generated-artifact",
        "authority": {
            "kind": "backend-code-defaults",
            "source_root": "api/configs",
            "model": "configs.app_config.DifyConfig",
        },
        "resolution": {
            "precedence": [
                "init_settings",
                "process_env",
                "remote_settings",
                "dotenv",
                "file_secrets",
                "toml",
                "code_default",
            ]
        },
        "variables": variables,
    }


def render_backend_env_reference_markdown(reference: BackendEnvReference) -> str:
    grouped: dict[str, list[BackendEnvVariableReference]] = defaultdict(list)
    for variable in reference["variables"]:
        grouped[variable["group"]].append(variable)

    lines = [
        "# Backend Env Reference",
        "",
        "> Generated from `api/configs/**/*.py`. Do not edit manually.",
        "",
        "This reference documents backend env input semantics and code defaults only.",
        "Deployment defaults, `.env.example`, and runtime-effective values are intentionally excluded.",
        "",
        "## Value Resolution Order",
        "",
        "```text",
        " > ".join(reference["resolution"]["precedence"]),
        "```",
        "",
        "Code defaults are fallback values only. Runtime process environment, remote settings, and dotenv values can override them.",
        "",
    ]

    for group in sorted(grouped):
        lines.extend([f"## `{group}`", ""])
        lines.extend(_render_group_applicability_notes(grouped[group]))
        lines.append("| Name | Type | Default | Accepted Env Names | Description |")
        lines.append("| --- | --- | --- | --- | --- |")

        for variable in grouped[group]:
            code_default = _render_code_default(variable["code_default"])
            aliases = _markdown_code_cell(", ".join(variable["accepted_names"]))
            description = _markdown_cell(_normalize_description(variable["description"]))
            variable_type = _markdown_code_cell(variable["type"])
            lines.append(
                f"| `{variable['name']}` | {variable_type} | {code_default} | {aliases} | {description} |"
            )
        lines.append("")

    return "\n".join(lines)


def write_backend_env_reference(
    json_output: Path = _JSON_OUTPUT,
    markdown_output: Path = _MARKDOWN_OUTPUT,
) -> tuple[Path, Path]:
    reference = build_backend_env_reference()
    json_output.parent.mkdir(parents=True, exist_ok=True)
    markdown_output.parent.mkdir(parents=True, exist_ok=True)
    json_output.write_text(json.dumps(reference, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    markdown_output.write_text(render_backend_env_reference_markdown(reference) + "\n", encoding="utf-8")
    return json_output, markdown_output


def main() -> None:
    json_output, markdown_output = write_backend_env_reference()
    logger.info("Wrote %s", json_output.relative_to(_REPO_ROOT))
    logger.info("Wrote %s", markdown_output.relative_to(_REPO_ROOT))


if __name__ == "__main__":
    main()
