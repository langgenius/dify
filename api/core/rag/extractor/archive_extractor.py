"""Archive extractor for compressed files."""

import os
import shutil
import tarfile
import tempfile
import zipfile
from pathlib import Path
from typing import Optional

from core.rag.extractor.extract_processor import ExtractProcessor
from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.extractor.entity.extract_setting import ExtractSetting
from core.rag.models.document import Document


class ArchiveExtractor(BaseExtractor):
    """Extract documents from compressed archive files.
    
    Supports: .zip, .tar, .tar.gz, .tar.bz2, .7z, .rar
    
    Args:
        file_path: Path to the archive file to extract.
        max_file_size: Maximum size in bytes for individual files (default: 100MB).
        max_total_size: Maximum total size in bytes for all extracted files (default: 1GB).
        timeout: Maximum time in seconds for extraction (default: 300).
    """

    def __init__(
        self,
        file_path: str,
        max_file_size: int = 100 * 1024 * 1024,  # 100MB
        max_total_size: int = 1024 * 1024 * 1024,  # 1GB
        timeout: int = 300,  # 5 minutes
    ):
        """Initialize with file path and security limits."""
        self._file_path = file_path
        self._max_file_size = max_file_size
        self._max_total_size = max_total_size
        self._timeout = timeout
        self._temp_dir: Optional[str] = None

    def extract(self) -> list[Document]:
        """Extract documents from archive file."""
        documents = []
        
        try:
            # Create temporary directory for extraction
            self._temp_dir = tempfile.mkdtemp(prefix="dify_archive_")
            
            # Extract archive based on file extension
            archive_format = self._detect_archive_format()
            if not archive_format:
                raise ValueError(f"Unsupported archive format: {self._file_path}")
            
            # Extract files with security checks
            extracted_files = self._extract_archive(archive_format)
            
            # Process each extracted file
            for file_info in extracted_files:
                try:
                    file_documents = self._process_extracted_file(file_info)
                    documents.extend(file_documents)
                except Exception as e:
                    # Log error but continue processing other files
                    print(f"Warning: Failed to process {file_info['path']}: {e}")
                    continue
            
            return documents
            
        except Exception as e:
            raise RuntimeError(f"Failed to extract archive {self._file_path}: {e}") from e
        finally:
            # Clean up temporary directory
            if self._temp_dir and os.path.exists(self._temp_dir):
                shutil.rmtree(self._temp_dir, ignore_errors=True)

    def _detect_archive_format(self) -> Optional[str]:
        """Detect archive format based on file extension."""
        file_path = Path(self._file_path)
        suffix = file_path.suffix.lower()
        
        if suffix == '.zip':
            return 'zip'
        elif suffix == '.tar':
            return 'tar'
        elif file_path.suffixes[-2:] == ['.tar', '.gz'] or suffix == '.tgz':
            return 'tar.gz'
        elif file_path.suffixes[-2:] == ['.tar', '.bz2'] or suffix == '.tbz2':
            return 'tar.bz2'
        elif suffix in ['.7z']:
            return '7z'
        elif suffix == '.rar':
            return 'rar'
        
        return None

    def _extract_archive(self, archive_format: str) -> list[dict]:
        """Extract archive files with security checks."""
        extracted_files = []
        total_size = [0]  # Use list to allow modification by reference
        
        if archive_format == 'zip':
            extracted_files = self._extract_zip(total_size)
        elif archive_format.startswith('tar'):
            extracted_files = self._extract_tar(archive_format, total_size)
        elif archive_format == '7z':
            extracted_files = self._extract_7z(total_size)
        elif archive_format == 'rar':
            extracted_files = self._extract_rar(total_size)
        else:
            raise ValueError(f"Unsupported archive format: {archive_format}")
        
        return extracted_files

    def _extract_zip(self, total_size: list) -> list[dict]:
        """Extract ZIP archive."""
        extracted_files = []
        
        try:
            with zipfile.ZipFile(self._file_path, 'r') as zip_ref:
                for member in zip_ref.infolist():
                    # Security checks
                    if self._is_safe_path(member.filename):
                        # Check file size
                        if member.file_size > self._max_file_size:
                            print(f"Warning: Skipping large file {member.filename} ({member.file_size} bytes)")
                            continue
                        
                        # Check total size
                        total_size[0] += member.file_size
                        if total_size[0] > self._max_total_size:
                            print(f"Warning: Total extraction size limit exceeded, stopping extraction")
                            break
                        
                        # Extract file
                        if not member.is_dir():
                            zip_ref.extract(member, self._temp_dir)
                            extracted_path = os.path.join(self._temp_dir, member.filename)
                            extracted_files.append({
                                'path': extracted_path,
                                'relative_path': member.filename,
                                'size': member.file_size
                            })
        except zipfile.BadZipFile as e:
            raise ValueError(f"Invalid or corrupted ZIP file: {e}")
        except Exception as e:
            raise RuntimeError(f"Failed to extract ZIP file: {e}")
        
        return extracted_files

    def _extract_tar(self, archive_format: str, total_size: list) -> list[dict]:
        """Extract TAR archive (including .tar.gz, .tar.bz2)."""
        extracted_files = []
        
        try:
            mode = 'r'
            if archive_format == 'tar.gz':
                mode = 'r:gz'
            elif archive_format == 'tar.bz2':
                mode = 'r:bz2'
            
            with tarfile.open(self._file_path, mode) as tar_ref:
                for member in tar_ref.getmembers():
                    # Security checks
                    if self._is_safe_path(member.name) and member.isfile():
                        # Check file size
                        if member.size > self._max_file_size:
                            print(f"Warning: Skipping large file {member.name} ({member.size} bytes)")
                            continue
                        
                        # Check total size
                        total_size[0] += member.size
                        if total_size[0] > self._max_total_size:
                            print(f"Warning: Total extraction size limit exceeded, stopping extraction")
                            break
                        
                        # Extract file
                        tar_ref.extract(member, self._temp_dir)
                        extracted_path = os.path.join(self._temp_dir, member.name)
                        extracted_files.append({
                            'path': extracted_path,
                            'relative_path': member.name,
                            'size': member.size
                        })
        except tarfile.TarError as e:
            raise ValueError(f"Invalid or corrupted TAR file: {e}")
        except Exception as e:
            raise RuntimeError(f"Failed to extract TAR file: {e}")
        
        return extracted_files

    def _extract_7z(self, total_size: list) -> list[dict]:
        """Extract 7Z archive (requires py7zr library)."""
        try:
            import py7zr
        except ImportError:
            raise RuntimeError("py7zr library is required for 7z support. Install with: pip install py7zr")
        
        extracted_files = []
        
        try:
            with py7zr.SevenZipFile(self._file_path, mode='r') as archive:
                for info in archive.list():
                    if not info.is_dir and self._is_safe_path(info.filename):
                        # Check file size
                        if info.uncompressed > self._max_file_size:
                            print(f"Warning: Skipping large file {info.filename} ({info.uncompressed} bytes)")
                            continue
                        
                        # Check total size
                        total_size[0] += info.uncompressed
                        if total_size[0] > self._max_total_size:
                            print(f"Warning: Total extraction size limit exceeded, stopping extraction")
                            break
                
                # Extract all files at once (py7zr limitation)
                archive.extractall(path=self._temp_dir)
                
                # Collect extracted files
                for root, dirs, files in os.walk(self._temp_dir):
                    for file in files:
                        full_path = os.path.join(root, file)
                        relative_path = os.path.relpath(full_path, self._temp_dir)
                        file_size = os.path.getsize(full_path)
                        extracted_files.append({
                            'path': full_path,
                            'relative_path': relative_path,
                            'size': file_size
                        })
        except Exception as e:
            raise RuntimeError(f"Failed to extract 7Z file: {e}")
        
        return extracted_files

    def _extract_rar(self, total_size: list) -> list[dict]:
        """Extract RAR archive (requires rarfile library)."""
        try:
            import rarfile
        except ImportError:
            raise RuntimeError("rarfile library is required for RAR support. Install with: pip install rarfile")
        
        extracted_files = []
        
        try:
            with rarfile.RarFile(self._file_path) as rar_ref:
                for member in rar_ref.infolist():
                    if not member.is_dir() and self._is_safe_path(member.filename):
                        # Check file size
                        if member.file_size > self._max_file_size:
                            print(f"Warning: Skipping large file {member.filename} ({member.file_size} bytes)")
                            continue
                        
                        # Check total size
                        total_size[0] += member.file_size
                        if total_size[0] > self._max_total_size:
                            print(f"Warning: Total extraction size limit exceeded, stopping extraction")
                            break
                        
                        # Extract file
                        rar_ref.extract(member, self._temp_dir)
                        extracted_path = os.path.join(self._temp_dir, member.filename)
                        extracted_files.append({
                            'path': extracted_path,
                            'relative_path': member.filename,
                            'size': member.file_size
                        })
        except rarfile.BadRarFile as e:
            raise ValueError(f"Invalid or corrupted RAR file: {e}")
        except Exception as e:
            raise RuntimeError(f"Failed to extract RAR file: {e}")
        
        return extracted_files

    def _is_safe_path(self, path: str) -> bool:
        """Check if the path is safe (no directory traversal)."""
        # Normalize path and check for directory traversal
        normalized = os.path.normpath(path)
        return not (normalized.startswith('/') or normalized.startswith('..') or '\\' in normalized)

    def _process_extracted_file(self, file_info: dict) -> list[Document]:
        """Process an extracted file using appropriate extractor."""
        file_path = file_info['path']
        relative_path = file_info['relative_path']
        file_size = file_info['size']
        
        # Use ExtractProcessor to handle the file
        processor = ExtractProcessor()
        extract_setting = ExtractSetting(datasource_type="file", file_path=file_path)
        documents = processor.extract(extract_setting, file_path=file_path)
        
        # Enhance metadata for each document
        for doc in documents:
            # Add archive-specific metadata
            doc.metadata.update({
                'archive_source': self._file_path,
                'archive_path': relative_path,
                'archive_format': self._detect_archive_format(),
                'extracted_file_size': file_size,
                'original_source': doc.metadata.get('source', file_path)
            })
            
            # Update source to indicate it came from an archive
            doc.metadata['source'] = f"{self._file_path}#{relative_path}"
        
        return documents