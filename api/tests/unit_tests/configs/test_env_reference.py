import json

from configs.env_reference import (
    build_backend_env_reference,
    render_backend_env_reference_markdown,
)
 

def test_backend_env_reference_uses_backend_authority() -> None:
    reference = build_backend_env_reference()

    assert reference["authority"]["source_root"] == "api/configs"
    assert reference["authority"]["model"] == "configs.app_config.DifyConfig"
    assert reference["resolution"]["precedence"][-1] == "code_default"


def test_backend_env_reference_includes_aliases_and_defaults() -> None:
    reference = build_backend_env_reference()
    variables = {variable["name"]: variable for variable in reference["variables"]}

    files_url = variables["FILES_URL"]
    redis_host = variables["REDIS_HOST"]

    assert "CONSOLE_API_URL" in files_url["accepted_names"]
    assert redis_host["code_default"] == "localhost"
    assert redis_host["group"] == "middleware.cache.redis"
    assert "source_location" not in redis_host
    assert "sensitive" not in redis_host


def test_backend_env_reference_excludes_computed_and_nested_fields() -> None:
    reference = build_backend_env_reference()
    names = {variable["name"] for variable in reference["variables"]}

    assert "SQLALCHEMY_DATABASE_URI" not in names
    assert "normalized_pubsub_redis_url" not in names
    assert "project" not in names


def test_backend_env_reference_marks_provider_applicability() -> None:
    reference = build_backend_env_reference()
    variables = {variable["name"]: variable for variable in reference["variables"]}

    assert variables["S3_ACCESS_KEY"]["applies_when"] == "STORAGE_TYPE=s3"
    assert variables["STORAGE_LOCAL_PATH"]["applies_when"] == "STORAGE_TYPE=local"


def test_backend_env_reference_markdown_explains_code_default_scope() -> None:
    reference = build_backend_env_reference()
    markdown = render_backend_env_reference_markdown(reference)

    assert "Deployment defaults, `.env.example`, and runtime-effective values are intentionally excluded." in markdown
    assert "Code defaults are fallback values only." in markdown
    assert "`REDIS_HOST`" in markdown
    assert "| Name | Type | Default | Accepted Env Names | Description |" in markdown
    assert "Code Default" not in markdown
    assert "Required |" not in markdown
    assert "Applies When |" not in markdown
    assert "Source |" not in markdown


def test_backend_env_reference_markdown_normalizes_multiline_cells() -> None:
    markdown = render_backend_env_reference_markdown(
        {
            "schema_version": "1",
            "artifact_policy": "committed-generated-artifact",
            "authority": {"kind": "backend-code-defaults", "source_root": "api/configs", "model": "configs.app_config.DifyConfig"},
            "resolution": {"precedence": ["process_env", "code_default"]},
            "variables": [
                {
                    "name": "EXAMPLE_ENV",
                    "accepted_names": ["EXAMPLE_ENV", "EXAMPLE_ALIAS"],
                    "group": "test.group",
                    "type": "string | null",
                    "description": "line one\nline two | extra",
                    "code_default": "value\nwith newline",
                    "applies_when": "MODE=demo\nENABLED=true",
                    "required": False,
                }
            ],
        }
    )

    assert "line one line two \\| extra" in markdown
    assert "> Applies when: `MODE=demo ENABLED=true`" in markdown
    assert "`string \\| null`" in markdown
    assert '`"value with newline"`' in markdown
    assert "\nline two" not in markdown


def test_backend_env_reference_markdown_groups_partial_applicability_notes() -> None:
    markdown = render_backend_env_reference_markdown(
        {
            "schema_version": "1",
            "artifact_policy": "committed-generated-artifact",
            "authority": {"kind": "backend-code-defaults", "source_root": "api/configs", "model": "configs.app_config.DifyConfig"},
            "resolution": {"precedence": ["process_env", "code_default"]},
            "variables": [
                {
                    "name": "S3_ACCESS_KEY",
                    "accepted_names": ["S3_ACCESS_KEY"],
                    "group": "storage.s3",
                    "type": "string",
                    "description": "Access key",
                    "code_default": None,
                    "required": False,
                    "applies_when": "STORAGE_TYPE=s3",
                },
                {
                    "name": "S3_SECRET_KEY",
                    "accepted_names": ["S3_SECRET_KEY"],
                    "group": "storage.s3",
                    "type": "string",
                    "description": "Secret key",
                    "code_default": None,
                    "required": False,
                    "applies_when": "STORAGE_TYPE=s3",
                },
                {
                    "name": "STORAGE_ENDPOINT",
                    "accepted_names": ["STORAGE_ENDPOINT"],
                    "group": "storage.s3",
                    "type": "string | null",
                    "description": "Endpoint override",
                    "code_default": None,
                    "required": False,
                    "applies_when": None,
                },
            ],
        }
    )

    assert "Applies when:" in markdown
    assert "- `S3_ACCESS_KEY`, `S3_SECRET_KEY`: `STORAGE_TYPE=s3`" in markdown
    assert "Applies When |" not in markdown


def test_backend_env_reference_markdown_normalizes_awkward_descriptions() -> None:
    markdown = render_backend_env_reference_markdown(
        {
            "schema_version": "1",
            "artifact_policy": "committed-generated-artifact",
            "authority": {"kind": "backend-code-defaults", "source_root": "api/configs", "model": "configs.app_config.DifyConfig"},
            "resolution": {"precedence": ["process_env", "code_default"]},
            "variables": [
                {
                    "name": "ENTERPRISE_ENABLED",
                    "accepted_names": ["ENTERPRISE_ENABLED"],
                    "group": "enterprise.feature",
                    "type": "boolean",
                    "description": (
                        "Enable or disable enterprise-level features.Before using, please contact "
                        "business@dify.ai by email to inquire about licensing matters."
                    ),
                    "code_default": False,
                    "required": False,
                    "applies_when": None,
                },
                {
                    "name": "FILES_URL",
                    "accepted_names": ["FILES_URL", "CONSOLE_API_URL"],
                    "group": "feature.file-access",
                    "type": "string",
                    "description": (
                        "Base URL for file preview or download, used for frontend display and "
                        "multi-model inputsUrl is signed and has expiration time."
                    ),
                    "code_default": "",
                    "required": False,
                    "applies_when": None,
                },
            ],
        }
    )

    assert "features. Before using, please contact business@dify.ai" in markdown
    assert "multi-model inputs. The URL is signed and has an expiration time." in markdown


def test_backend_env_reference_markdown_renders_missing_defaults_explicitly() -> None:
    markdown = render_backend_env_reference_markdown(
        {
            "schema_version": "1",
            "artifact_policy": "committed-generated-artifact",
            "authority": {"kind": "backend-code-defaults", "source_root": "api/configs", "model": "configs.app_config.DifyConfig"},
            "resolution": {"precedence": ["process_env", "code_default"]},
            "variables": [
                {
                    "name": "SENTRY_DSN",
                    "accepted_names": ["SENTRY_DSN"],
                    "group": "extra.sentry",
                    "type": "string | null",
                    "description": "Sentry DSN",
                    "code_default": None,
                    "required": False,
                    "applies_when": None,
                }
            ],
        }
    )

    row = '| `SENTRY_DSN` | `string \\| null` | `""` | `SENTRY_DSN` | Sentry DSN |'

    assert row in markdown
    assert row.count(" | ") == 4


def test_backend_env_reference_markdown_keeps_code_default_column_styling_consistent() -> None:
    markdown = render_backend_env_reference_markdown(
        {
            "schema_version": "1",
            "artifact_policy": "committed-generated-artifact",
            "authority": {"kind": "backend-code-defaults", "source_root": "api/configs", "model": "configs.app_config.DifyConfig"},
            "resolution": {"precedence": ["process_env", "code_default"]},
            "variables": [
                {
                    "name": "EMPTY_DEFAULT",
                    "accepted_names": ["EMPTY_DEFAULT"],
                    "group": "test.group",
                    "type": "string | null",
                    "description": "Empty default placeholder",
                    "code_default": None,
                    "required": False,
                    "applies_when": None,
                },
                {
                    "name": "STRING_DEFAULT",
                    "accepted_names": ["STRING_DEFAULT"],
                    "group": "test.group",
                    "type": "string",
                    "description": "Concrete string default",
                    "code_default": "value",
                    "required": False,
                    "applies_when": None,
                },
            ],
        }
    )

    assert '| `EMPTY_DEFAULT` | `string \\| null` | `""` | `EMPTY_DEFAULT` | Empty default placeholder |' in markdown
    assert '| `STRING_DEFAULT` | `string` | `"value"` | `STRING_DEFAULT` | Concrete string default |' in markdown


def test_backend_env_reference_is_json_serializable() -> None:
    reference = build_backend_env_reference()
    rendered = json.dumps(reference)

    assert '"schema_version": "1"' in rendered
    assert '"resolution"' in rendered
    assert '"source_location"' not in rendered
    assert '"sensitive"' not in rendered
