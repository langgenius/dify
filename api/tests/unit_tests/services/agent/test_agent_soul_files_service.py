import json

from models.agent_config_entities import AgentSoulConfig
from services.agent.soul_files_service import AgentSoulFilesService


def test_apply_drive_commit_records_skill_and_file_refs_in_agent_soul():
    soul = AgentSoulConfig()

    AgentSoulFilesService._apply_commit_item(
        agent_soul=soul,
        item={
            "key": "tender-analyzer/SKILL.md",
            "file_kind": "tool_file",
            "file_id": "skill-md-file",
            "is_skill": True,
            "skill_metadata": json.dumps(
                {
                    "name": "Tender Analyzer",
                    "description": "Parses tenders.",
                    "manifest_files": ["SKILL.md", "src/main.py"],
                }
            ),
        },
    )
    AgentSoulFilesService._apply_commit_item(
        agent_soul=soul,
        item={
            "key": "files/sample.pdf",
            "file_kind": "upload_file",
            "file_id": "upload-file",
            "mime_type": "application/pdf",
            "is_skill": False,
        },
    )

    assert [skill.model_dump(mode="json", exclude_none=True) for skill in soul.files.skills] == [
        {
            "id": "tender-analyzer",
            "name": "Tender Analyzer",
            "description": "Parses tenders.",
            "file_id": "skill-md-file",
            "path": "tender-analyzer",
            "skill_md_key": "tender-analyzer/SKILL.md",
            "skill_md_file_id": "skill-md-file",
            "full_archive_key": "tender-analyzer/.DIFY-SKILL-FULL.zip",
            "manifest_files": ["SKILL.md", "src/main.py"],
        }
    ]
    assert [file_ref.model_dump(mode="json", exclude_none=True) for file_ref in soul.files.files] == [
        {
            "id": "files/sample.pdf",
            "file_id": "upload-file",
            "upload_file_id": "upload-file",
            "name": "sample.pdf",
            "type": "application/pdf",
            "transfer_method": "upload_file",
            "drive_key": "files/sample.pdf",
        }
    ]


def test_apply_drive_commit_removes_refs_without_touching_unrelated_entries():
    soul = AgentSoulConfig.model_validate(
        {
            "files": {
                "skills": [
                    {
                        "id": "tender-analyzer",
                        "name": "Tender Analyzer",
                        "path": "tender-analyzer",
                        "skill_md_key": "tender-analyzer/SKILL.md",
                        "full_archive_key": "tender-analyzer/.DIFY-SKILL-FULL.zip",
                    }
                ],
                "files": [
                    {"id": "files/sample.pdf", "name": "sample.pdf", "drive_key": "files/sample.pdf"},
                    {"id": "files/keep.pdf", "name": "keep.pdf", "drive_key": "files/keep.pdf"},
                ],
            }
        }
    )

    AgentSoulFilesService._apply_commit_item(agent_soul=soul, item={"key": "files/sample.pdf", "removed": True})
    AgentSoulFilesService._apply_commit_item(agent_soul=soul, item={"key": "tender-analyzer/SKILL.md", "removed": True})

    assert [file_ref.drive_key for file_ref in soul.files.files] == ["files/keep.pdf"]
    assert soul.files.skills == []


def test_drive_copy_and_access_scopes_come_from_agent_soul_files():
    soul = AgentSoulConfig.model_validate(
        {
            "files": {
                "skills": [
                    {
                        "id": "tender-analyzer",
                        "name": "Tender Analyzer",
                        "path": "tender-analyzer",
                        "skill_md_key": "tender-analyzer/SKILL.md",
                        "full_archive_key": "tender-analyzer/.DIFY-SKILL-FULL.zip",
                    }
                ],
                "files": [{"id": "files/sample.pdf", "name": "sample.pdf", "drive_key": "files/sample.pdf"}],
            }
        }
    )

    exact_keys, prefixes = AgentSoulFilesService.drive_copy_scopes(agent_soul=soul)

    assert exact_keys == {
        "tender-analyzer/SKILL.md",
        "tender-analyzer/.DIFY-SKILL-FULL.zip",
        "files/sample.pdf",
    }
    assert prefixes == {"tender-analyzer/"}
    assert AgentSoulFilesService.key_allowed_by_soul(agent_soul=soul, key="tender-analyzer/src/main.py") is True
    assert AgentSoulFilesService.key_allowed_by_soul(agent_soul=soul, key="files/other.pdf") is False
