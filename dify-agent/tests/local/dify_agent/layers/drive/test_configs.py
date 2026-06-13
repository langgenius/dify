"""Contract tests for the dify.drive declaration layer (ENG-623)."""

import pytest
from pydantic import ValidationError

from dify_agent.layers.drive import (
    DIFY_DRIVE_LAYER_TYPE_ID,
    DifyDriveFileConfig,
    DifyDriveLayerConfig,
    DifyDriveSkillConfig,
)
from dify_agent.layers.drive.layer import DifyDriveLayer
from dify_agent.runtime.compositor_factory import create_default_layer_providers


def test_type_id_is_frozen_contract() -> None:
    assert DIFY_DRIVE_LAYER_TYPE_ID == "dify.drive"
    assert DifyDriveLayer.type_id == DIFY_DRIVE_LAYER_TYPE_ID


def test_layer_config_round_trips_manifest_entries() -> None:
    config = DifyDriveLayerConfig.model_validate(
        {
            "drive_ref": "agent-019e9112",
            "skills": [
                {
                    "name": "Tender Analyzer",
                    "description": "Parses RFP documents step by step.",
                    "skill_md_key": "tender-analyzer/SKILL.md",
                    "archive_key": "tender-analyzer/.DIFY-SKILL-FULL.zip",
                }
            ],
            "files": [{"name": "sample.pdf", "key": "files/sample.pdf", "size": 1024, "mime_type": "application/pdf"}],
        }
    )

    dumped = config.model_dump(mode="json")
    assert dumped["drive_ref"] == "agent-019e9112"
    assert dumped["skills"][0]["skill_md_key"] == "tender-analyzer/SKILL.md"
    assert dumped["files"][0]["key"] == "files/sample.pdf"
    # the declaration is an index only — there is no field that could carry file content
    assert "content" not in DifyDriveSkillConfig.model_fields
    assert "content" not in DifyDriveFileConfig.model_fields


def test_layer_config_rejects_unknown_fields() -> None:
    with pytest.raises(ValidationError):
        DifyDriveLayerConfig.model_validate({"drive_ref": "agent-1", "skill_md_body": "# inline content"})


def test_inert_layer_is_registered_and_constructible_from_config() -> None:
    providers = create_default_layer_providers()
    provider = next(p for p in providers if p.type_id == DIFY_DRIVE_LAYER_TYPE_ID)

    layer = provider.create_layer({"drive_ref": "agent-1", "skills": [], "files": []})

    assert isinstance(layer, DifyDriveLayer)
    assert layer.config.drive_ref == "agent-1"
