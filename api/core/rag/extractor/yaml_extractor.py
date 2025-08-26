"""YAML file extractor for document processing."""

from typing import Any, Optional

import yaml

from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.extractor.helpers import detect_file_encodings
from core.rag.models.document import Document


class YamlExtractor(BaseExtractor):
    """Extract and process YAML files into Document objects.

    This extractor handles both YAML objects and arrays, converting each top-level
    element into a separate Document with preserved structure and metadata.

    Args:
        file_path: Path to the YAML file to load.
        encoding: File encoding to use. If None, will attempt to detect automatically.
        autodetect_encoding: Whether to automatically detect file encoding on decode errors.
    """

    def __init__(
        self,
        file_path: str,
        encoding: Optional[str] = None,
        autodetect_encoding: bool = True,
    ):
        """Initialize the YAML extractor.

        Args:
            file_path: Path to the YAML file to extract.
            encoding: File encoding to use for reading.
            autodetect_encoding: Whether to auto-detect encoding on errors.
        """
        self._file_path = file_path
        self._encoding = encoding or "utf-8"
        self._autodetect_encoding = autodetect_encoding

    def extract(self) -> list[Document]:
        """Extract documents from the YAML file.

        Returns:
            List of Document objects, one for each top-level YAML element.

        Raises:
            RuntimeError: If the file cannot be read or parsed.
            yaml.YAMLError: If the YAML content is malformed.
        """
        docs = []

        try:
            with open(self._file_path, encoding=self._encoding) as file:
                docs = self._parse_yaml_content(file.read())
        except UnicodeDecodeError as e:
            if self._autodetect_encoding:
                detected_encodings = detect_file_encodings(self._file_path)
                for encoding_info in detected_encodings:
                    try:
                        with open(self._file_path, encoding=encoding_info.encoding) as file:
                            docs = self._parse_yaml_content(file.read())
                        break
                    except UnicodeDecodeError:
                        continue
                else:
                    raise RuntimeError(f"Unable to decode file {self._file_path} with any detected encoding") from e
            else:
                raise RuntimeError(f"Error loading {self._file_path}: {str(e)}") from e
        except Exception as e:
            raise RuntimeError(f"Error reading file {self._file_path}: {str(e)}") from e

        return docs

    def _parse_yaml_content(self, content: str) -> list[Document]:
        """Parse YAML content and convert to Document objects.

        Args:
            content: Raw YAML content as string.

        Returns:
            List of Document objects.

        Raises:
            yaml.YAMLError: If YAML parsing fails.
        """
        try:
            # Parse YAML content - this can return various types
            yaml_data = yaml.safe_load(content)

            if yaml_data is None:
                return []

            return self._convert_to_documents(yaml_data)

        except yaml.YAMLError as e:
            raise yaml.YAMLError(f"Failed to parse YAML content: {str(e)}") from e

    def _convert_to_documents(self, data: Any) -> list[Document]:
        """Convert parsed YAML data to Document objects.

        Args:
            data: Parsed YAML data (can be dict, list, or primitive).

        Returns:
            List of Document objects.
        """
        documents = []

        if isinstance(data, dict):
            # Handle YAML object - create one document
            documents.append(self._create_document_from_dict(data, 0))

        elif isinstance(data, list):
            # Handle YAML array - create document for each element
            for index, item in enumerate(data):
                if isinstance(item, dict):
                    documents.append(self._create_document_from_dict(item, index, is_array_item=True))
                else:
                    # Handle primitive values in array
                    documents.append(self._create_document_from_primitive(item, index, is_array_item=True))

        else:
            # Handle single primitive value
            documents.append(self._create_document_from_primitive(data, 0))

        return documents

    def _create_document_from_dict(self, data: dict[str, Any], index: int, is_array_item: bool = False) -> Document:
        """Create a Document from a dictionary object.

        Args:
            data: Dictionary data to convert.
            index: Index of this object in the source.
            is_array_item: True when this element is an item within a YAML array,
                          used to set the correct type in metadata.
            
        Returns:
            Document object with content and metadata.
        """
        # Convert dict to YAML string for content
        content = yaml.dump(data, default_flow_style=False, allow_unicode=True).strip()

        # Extract keys for metadata
        keys = list(data.keys()) if data else []

        # Create searchable text from keys and string values
        searchable_parts = []
        searchable_parts.extend(keys)  # Add all keys

        # Add string values (not nested objects/arrays)
        for key, value in data.items():
            if isinstance(value, str):
                searchable_parts.append(value)
            elif isinstance(value, (int, float, bool)):
                searchable_parts.append(str(value))

        searchable_text = " ".join(searchable_parts)

        metadata = {
            "source": self._file_path,
            "index": index,
            "type": "array_item" if is_array_item else "object",
            "keys": keys,
            "key_count": len(keys),
            "searchable_text": searchable_text,
        }

        return Document(page_content=content, metadata=metadata)

    def _create_document_from_primitive(self, data: Any, index: int, is_array_item: bool = False) -> Document:
        """Create a Document from a primitive value.

        Args:
            data: Primitive data to convert.
            index: Index of this value in the source.
            is_array_item: True when this element is an item within a YAML array,
                          used to set the correct type in metadata.
            
        Returns:
            Document object with content and metadata.
        """
        # Convert to string for content
        content = str(data) if data is not None else ""

        # Determine the type
        if is_array_item:
            data_type = "array_item"
        else:
            data_type = type(data).__name__

        metadata = {
            "source": self._file_path,
            "index": index,
            "type": data_type,
            "keys": [],
            "key_count": 0,
            "searchable_text": content,
        }

        return Document(page_content=content, metadata=metadata)
