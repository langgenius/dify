from libs.validate_utils import bytes_to_str


def test_bytes_to_str():
    assert bytes_to_str(500) == "500 bytes"
    assert bytes_to_str(1024) == "1.00 KB"
    assert bytes_to_str(1500) == "1.46 KB"
    assert bytes_to_str(2 * 1024 * 1024) == "2.00 MB"
