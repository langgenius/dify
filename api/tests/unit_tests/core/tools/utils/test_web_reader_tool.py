from core.tools.utils.web_reader_tool import get_image_upload_file_ids


def test_get_image_upload_file_ids():
    # should extract id from https + file-preview
    content = "![image](https://example.com/a/b/files/abc123/file-preview)"
    assert get_image_upload_file_ids(content) == ["abc123"]

    # should extract id from http + image-preview
    content = "![image](http://host/files/xyz789/image-preview)"
    assert get_image_upload_file_ids(content) == ["xyz789"]

    # should not match invalid scheme 'htt://'
    content = "![image](htt://host/files/bad/file-preview)"
    assert get_image_upload_file_ids(content) == []

    # should extract multiple ids in order
    content = """
    some text
    ![image](https://h/files/id1/file-preview)
    middle
    ![image](http://h/files/id2/image-preview)
    end
    """
    assert get_image_upload_file_ids(content) == ["id1", "id2"]
