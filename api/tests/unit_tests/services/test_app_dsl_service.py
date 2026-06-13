from services.app_dsl_service import AppDslService


def test_strip_tenant_file_defaults_removes_local_file_ids() -> None:
    workflow_dict = {
        "graph": {
            "nodes": [
                {
                    "data": {
                        "variables": [
                            {
                                "variable": "contract",
                                "type": "file",
                                "default": {
                                    "name": "contract.pdf",
                                    "transfer_method": "local_file",
                                    "type": "document",
                                    "upload_file_id": "source-workspace-file",
                                    "uploadedId": "source-workspace-file",
                                },
                            },
                            {
                                "variable": "attachments",
                                "type": "file-list",
                                "default": [
                                    {
                                        "name": "local.pdf",
                                        "transferMethod": "local_file",
                                        "type": "document",
                                        "uploadedId": "source-workspace-file-2",
                                    },
                                    {
                                        "name": "remote.pdf",
                                        "transfer_method": "remote_url",
                                        "url": "https://example.com/remote.pdf",
                                        "type": "document",
                                    },
                                ],
                            },
                            {
                                "variable": "notes",
                                "type": "text-input",
                                "default": {
                                    "upload_file_id": "not-a-file-variable",
                                },
                            },
                        ]
                    }
                }
            ]
        }
    }

    AppDslService._strip_tenant_file_defaults_from_workflow_dict(workflow_dict)

    variables = workflow_dict["graph"]["nodes"][0]["data"]["variables"]
    assert "default" not in variables[0]
    assert variables[1]["default"] == [
        {
            "name": "remote.pdf",
            "transfer_method": "remote_url",
            "url": "https://example.com/remote.pdf",
            "type": "document",
        }
    ]
    assert variables[2]["default"] == {"upload_file_id": "not-a-file-variable"}
