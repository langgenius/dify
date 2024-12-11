import json

from core.file import FILE_MODEL_IDENTITY, File, FileTransferMethod, FileType, FileUploadConfig
from models.workflow import Workflow


def test_file_loads_and_dumps():
    file = File(
        id="file1",
        tenant_id="tenant1",
        type=FileType.IMAGE,
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url="https://example.com/image1.jpg",
    )

    file_dict = file.model_dump()
    assert file_dict["dify_model_identity"] == FILE_MODEL_IDENTITY
    assert file_dict["type"] == file.type.value
    assert isinstance(file_dict["type"], str)
    assert file_dict["transfer_method"] == file.transfer_method.value
    assert isinstance(file_dict["transfer_method"], str)
    assert "_extra_config" not in file_dict

    file_obj = File.model_validate(file_dict)
    assert file_obj.id == file.id
    assert file_obj.tenant_id == file.tenant_id
    assert file_obj.type == file.type
    assert file_obj.transfer_method == file.transfer_method
    assert file_obj.remote_url == file.remote_url


def test_file_to_dict():
    file = File(
        id="file1",
        tenant_id="tenant1",
        type=FileType.IMAGE,
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url="https://example.com/image1.jpg",
    )

    file_dict = file.to_dict()
    assert "_extra_config" not in file_dict
    assert "url" in file_dict


def test_workflow_features_with_image():
    # Create a feature dict that mimics the old structure with image config
    features = {
        "file_upload": {
            "image": {"enabled": True, "number_limits": 5, "transfer_methods": ["remote_url", "local_file"]}
        }
    }

    # Create a workflow instance with the features
    workflow = Workflow(
        tenant_id="tenant-1",
        app_id="app-1",
        type="chat",
        version="1.0",
        graph="{}",
        features=json.dumps(features),
        created_by="user-1",
        environment_variables=[],
        conversation_variables=[],
    )

    # Get the converted features through the property
    converted_features = json.loads(workflow.features)

    # Create FileUploadConfig from the converted features
    file_upload_config = FileUploadConfig.model_validate(converted_features["file_upload"])

    # Validate the config
    assert file_upload_config.number_limits == 5
    assert list(file_upload_config.allowed_file_types) == [FileType.IMAGE]
    assert list(file_upload_config.allowed_file_upload_methods) == [
        FileTransferMethod.REMOTE_URL,
        FileTransferMethod.LOCAL_FILE,
    ]
    assert list(file_upload_config.allowed_file_extensions) == []
