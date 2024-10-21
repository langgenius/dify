from core.file import FILE_MODEL_IDENTITY, File, FileTransferMethod, FileType


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
