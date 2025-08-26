import os
import tempfile
import zipfile
import tarfile
from unittest.mock import Mock, patch
import pytest

from core.rag.extractor.archive_extractor import ArchiveExtractor
from core.rag.models.document import Document


class TestArchiveExtractor:
    """Test cases for ArchiveExtractor."""

    def setup_method(self):
        """Setup test fixtures."""
        self.temp_dir = tempfile.mkdtemp()
        self.extractor = ArchiveExtractor(file_path="dummy_path")

    def teardown_method(self):
        """Clean up test fixtures."""
        import shutil
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)

    def test_detect_archive_format_zip(self):
        """Test ZIP format detection."""
        zip_path = os.path.join(self.temp_dir, "test.zip")
        with zipfile.ZipFile(zip_path, 'w') as zf:
            zf.writestr("test.txt", "test content")
        
        extractor = ArchiveExtractor(file_path=zip_path)
        format_type = extractor._detect_archive_format(zip_path)
        assert format_type == "zip"

    def test_detect_archive_format_tar(self):
        """Test TAR format detection."""
        tar_path = os.path.join(self.temp_dir, "test.tar")
        with tarfile.open(tar_path, 'w') as tf:
            info = tarfile.TarInfo(name="test.txt")
            info.size = len("test content")
            tf.addfile(info, fileobj=None)
        
        extractor = ArchiveExtractor(file_path=tar_path)
        format_type = extractor._detect_archive_format(tar_path)
        assert format_type == "tar"

    def test_detect_archive_format_unsupported(self):
        """Test unsupported format detection."""
        txt_path = os.path.join(self.temp_dir, "test.txt")
        with open(txt_path, 'w') as f:
            f.write("test content")
        
        extractor = ArchiveExtractor(file_path=txt_path)
        format_type = extractor._detect_archive_format(txt_path)
        assert format_type is None

    def test_is_safe_path_valid(self):
        """Test safe path validation for valid paths."""
        safe_paths = [
            "file.txt",
            "folder/file.txt",
            "deep/nested/folder/file.txt"
        ]
        
        for path in safe_paths:
            assert self.extractor._is_safe_path(path) is True

    def test_is_safe_path_invalid(self):
        """Test safe path validation for invalid paths."""
        unsafe_paths = [
            "../file.txt",
            "folder/../../../file.txt",
            "/absolute/path/file.txt",
            "folder\\..\\file.txt"
        ]
        
        for path in unsafe_paths:
            assert self.extractor._is_safe_path(path) is False

    @patch('core.rag.extractor.archive_extractor.ExtractProcessor')
    def test_process_extracted_file_text(self, mock_processor_class):
        """Test processing extracted text file."""
        # Create a test text file
        test_file = os.path.join(self.temp_dir, "test.txt")
        with open(test_file, 'w', encoding='utf-8') as f:
            f.write("Test content")
        
        # Mock ExtractProcessor
        mock_processor = Mock()
        mock_processor.extract.return_value = [
            Document(page_content="Test content", metadata={"source": test_file})
        ]
        mock_processor_class.return_value = mock_processor
        
        # Test processing
        documents = self.extractor._process_extracted_file(
            test_file, "test.txt", "test.zip", "zip"
        )
        
        assert len(documents) == 1
        assert documents[0].page_content == "Test content"
        assert documents[0].metadata["archive_path"] == "test.zip"
        assert documents[0].metadata["relative_path"] == "test.txt"
        assert documents[0].metadata["archive_format"] == "zip"

    @patch('core.rag.extractor.archive_extractor.ExtractProcessor')
    def test_process_extracted_file_unsupported(self, mock_processor_class):
        """Test processing unsupported file type."""
        # Create a test file with unsupported extension
        test_file = os.path.join(self.temp_dir, "test.unknown")
        with open(test_file, 'w') as f:
            f.write("Test content")
        
        # Mock ExtractProcessor to raise exception
        mock_processor = Mock()
        mock_processor.extract.side_effect = Exception("Unsupported file type")
        mock_processor_class.return_value = mock_processor
        
        # Test processing
        documents = self.extractor._process_extracted_file(
            test_file, "test.unknown", "test.zip", "zip"
        )
        
        assert len(documents) == 0

    def test_extract_zip_success(self):
        """Test successful ZIP extraction."""
        # Create test ZIP file
        zip_path = os.path.join(self.temp_dir, "test.zip")
        with zipfile.ZipFile(zip_path, 'w') as zf:
            zf.writestr("file1.txt", "Content 1")
            zf.writestr("folder/file2.txt", "Content 2")
        
        # Create extraction directory
        extract_dir = os.path.join(self.temp_dir, "extract")
        os.makedirs(extract_dir)
        
        # Test extraction
        extractor = ArchiveExtractor(file_path=zip_path)
        extractor._extract_zip(zip_path, extract_dir)
        
        # Verify extracted files
        assert os.path.exists(os.path.join(extract_dir, "file1.txt"))
        assert os.path.exists(os.path.join(extract_dir, "folder", "file2.txt"))
        
        with open(os.path.join(extract_dir, "file1.txt"), 'r') as f:
            assert f.read() == "Content 1"

    def test_extract_zip_unsafe_path(self):
        """Test ZIP extraction with unsafe paths."""
        # Create test ZIP file with unsafe path
        zip_path = os.path.join(self.temp_dir, "unsafe.zip")
        with zipfile.ZipFile(zip_path, 'w') as zf:
            zf.writestr("../unsafe.txt", "Unsafe content")
        
        # Create extraction directory
        extract_dir = os.path.join(self.temp_dir, "extract")
        os.makedirs(extract_dir)
        
        # Test extraction - should skip unsafe files
        extractor = ArchiveExtractor(file_path=zip_path)
        extractor._extract_zip(zip_path, extract_dir)
        
        # Verify unsafe file was not extracted
        assert not os.path.exists(os.path.join(extract_dir, "../unsafe.txt"))
        assert not os.path.exists(os.path.join(self.temp_dir, "unsafe.txt"))

    def test_extract_tar_success(self):
        """Test successful TAR extraction."""
        # Create test TAR file
        tar_path = os.path.join(self.temp_dir, "test.tar")
        with tarfile.open(tar_path, 'w') as tf:
            # Add file1.txt
            info1 = tarfile.TarInfo(name="file1.txt")
            content1 = b"Content 1"
            info1.size = len(content1)
            tf.addfile(info1, fileobj=None)
            
            # Add folder/file2.txt
            info2 = tarfile.TarInfo(name="folder/file2.txt")
            content2 = b"Content 2"
            info2.size = len(content2)
            tf.addfile(info2, fileobj=None)
        
        # Create extraction directory
        extract_dir = os.path.join(self.temp_dir, "extract")
        os.makedirs(extract_dir)
        
        # Test extraction
        extractor = ArchiveExtractor(file_path=tar_path)
        extractor._extract_tar(tar_path, extract_dir)
        
        # Note: This is a simplified test as tarfile.addfile with None fileobj
        # creates empty files. In real usage, files would have actual content.
        assert os.path.exists(os.path.join(extract_dir, "file1.txt"))
        assert os.path.exists(os.path.join(extract_dir, "folder", "file2.txt"))

    @patch('core.rag.extractor.archive_extractor.ExtractProcessor')
    def test_extract_full_workflow(self, mock_processor_class):
        """Test complete extraction workflow."""
        # Create test ZIP file
        zip_path = os.path.join(self.temp_dir, "test.zip")
        with zipfile.ZipFile(zip_path, 'w') as zf:
            zf.writestr("document.txt", "This is a test document")
            zf.writestr("readme.md", "# README\nThis is a readme file")
        
        # Mock ExtractProcessor
        mock_processor = Mock()
        mock_processor.extract.side_effect = [
            [Document(page_content="This is a test document", metadata={"source": "document.txt"})],
            [Document(page_content="# README\nThis is a readme file", metadata={"source": "readme.md"})]
        ]
        mock_processor_class.return_value = mock_processor
        
        # Test extraction
        extractor = ArchiveExtractor(file_path=zip_path)
        documents = extractor.extract()
        
        # Verify results
        assert len(documents) == 2
        
        # Check first document
        doc1 = documents[0]
        assert doc1.page_content == "This is a test document"
        assert doc1.metadata["archive_path"] == zip_path
        assert doc1.metadata["relative_path"] == "document.txt"
        assert doc1.metadata["archive_format"] == "zip"
        
        # Check second document
        doc2 = documents[1]
        assert doc2.page_content == "# README\nThis is a readme file"
        assert doc2.metadata["archive_path"] == zip_path
        assert doc2.metadata["relative_path"] == "readme.md"
        assert doc2.metadata["archive_format"] == "zip"

    def test_extract_unsupported_format(self):
        """Test extraction of unsupported format."""
        # Create a regular text file
        txt_path = os.path.join(self.temp_dir, "test.txt")
        with open(txt_path, 'w') as f:
            f.write("Not an archive")
        
        # Test extraction
        extractor = ArchiveExtractor(file_path=txt_path)
        
        with pytest.raises(ValueError, match="Unsupported archive format"):
            extractor.extract()

    def test_extract_corrupted_zip(self):
        """Test extraction of corrupted ZIP file."""
        # Create a corrupted ZIP file
        zip_path = os.path.join(self.temp_dir, "corrupted.zip")
        with open(zip_path, 'w') as f:
            f.write("This is not a valid ZIP file")
        
        # Test extraction
        extractor = ArchiveExtractor(file_path=zip_path)
        
        with pytest.raises(Exception):
            extractor.extract()

    def test_extract_large_file_limit(self):
        """Test file size limit enforcement."""
        # Create ZIP with large file
        zip_path = os.path.join(self.temp_dir, "large.zip")
        large_content = "x" * (100 * 1024 * 1024 + 1)  # Slightly over 100MB
        
        with zipfile.ZipFile(zip_path, 'w') as zf:
            zf.writestr("large_file.txt", large_content)
        
        # Test extraction - should raise exception due to size limit
        extractor = ArchiveExtractor(file_path=zip_path)
        
        with pytest.raises(ValueError, match="File size exceeds limit"):
            extractor.extract()