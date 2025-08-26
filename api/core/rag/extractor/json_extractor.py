import json
from typing import List, Optional

from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.models.document import Document


class JsonExtractor(BaseExtractor):
    """Extract text from JSON files.
    
    This extractor parses JSON files and converts each top-level object or array element
    into separate documents, preserving key-value relationships and nested structure information.
    """

    def __init__(self, file_path: str, file_content: Optional[str] = None):
        """Initialize with file path and optional file content.
        
        Args:
            file_path: Path to the JSON file to load
            file_content: Optional file content string (for testing)
        """
        self._file_path = file_path
        self._file_content = file_content

    def extract(self) -> List[Document]:
        """Extract documents from JSON file.
        
        Returns:
            List of Document objects, each containing a JSON object or array element
            
        Raises:
            ValueError: If the JSON file is malformed or cannot be parsed
        """
        try:
            # Read and decode the file content
            if self._file_content:
                text_content = self._file_content.decode('utf-8')
            else:
                with open(self._file_path, 'r', encoding='utf-8') as file:
                    text_content = file.read()
            
            # Parse JSON content
            try:
                json_data = json.loads(text_content)
            except json.JSONDecodeError as e:
                raise ValueError(f"Invalid JSON format in file {self._file_path}: {str(e)}")
            
            documents = []
            
            # Handle different JSON structures
            if isinstance(json_data, dict):
                # Single JSON object - create one document
                documents.append(self._create_document_from_object(json_data, 0))
            elif isinstance(json_data, list):
                # JSON array - create document for each element
                for index, item in enumerate(json_data):
                    documents.append(self._create_document_from_object(item, index))
            else:
                # Primitive value (string, number, boolean, null)
                content = json.dumps(json_data, ensure_ascii=False, indent=2)
                documents.append(Document(
                    page_content=content,
                    metadata={
                        'source': self._file_path,
                        'type': 'primitive',
                        'data_type': type(json_data).__name__
                    }
                ))
            
            return documents
            
        except Exception as e:
            raise ValueError(f"Error extracting JSON from {self._file_path}: {str(e)}")
    
    def _create_document_from_object(self, obj, index: int) -> Document:
        """Create a Document from a JSON object or primitive value.
        
        Args:
            obj: The JSON object, array, or primitive value
            index: Index of the object in the parent array (0 for single objects)
            
        Returns:
            Document object with formatted content and metadata
        """
        # Convert object to formatted JSON string
        content = json.dumps(obj, ensure_ascii=False, indent=2)
        
        # Determine object type and extract key information
        obj_type = type(obj).__name__
        metadata = {
            'source': self._file_path,
            'index': index,
            'type': obj_type
        }
        
        # Add additional metadata for objects
        if isinstance(obj, dict):
            metadata['keys'] = list(obj.keys())
            metadata['key_count'] = len(obj)
            
            # Extract top-level string values for better searchability
            text_values = []
            for key, value in obj.items():
                if isinstance(value, str):
                    text_values.append(f"{key}: {value}")
                elif isinstance(value, (int, float, bool)):
                    text_values.append(f"{key}: {str(value)}")
            
            if text_values:
                metadata['searchable_text'] = ' | '.join(text_values)
        
        elif isinstance(obj, list):
            metadata['length'] = len(obj)
            metadata['element_types'] = list(set(type(item).__name__ for item in obj))
        
        return Document(page_content=content, metadata=metadata)