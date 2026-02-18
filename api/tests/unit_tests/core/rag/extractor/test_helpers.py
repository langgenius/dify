import tempfile

from core.rag.extractor.helpers import FileEncoding, detect_file_encodings


def test_detect_file_encodings() -> None:
    with tempfile.NamedTemporaryFile(mode="w+t", suffix=".txt") as temp:
        temp.write("Shared data")
        temp_path = temp.name
        assert detect_file_encodings(temp_path) == [FileEncoding(encoding="utf_8", confidence=0.0, language="Unknown")]
