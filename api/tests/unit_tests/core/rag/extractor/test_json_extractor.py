import json
import tempfile
from pathlib import Path

from core.rag.extractor.json_extractor import JsonExtractor


def test_json_object_extraction():
    """Test extraction of a single JSON object."""
    json_data = {
        "name": "John Doe",
        "age": 30,
        "city": "New York",
        "skills": ["Python", "JavaScript"]
    }
    
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        json.dump(json_data, f, ensure_ascii=False, indent=2)
        temp_path = f.name
    
    try:
        extractor = JsonExtractor(temp_path)
        documents = extractor.extract()
        
        assert len(documents) == 1
        doc = documents[0]
        
        # Check metadata
        assert doc.metadata['source'] == temp_path
        assert doc.metadata['index'] == 0
        assert doc.metadata['type'] == 'dict'
        assert doc.metadata['keys'] == ['name', 'age', 'city', 'skills']
        assert doc.metadata['key_count'] == 4
        assert 'name: John Doe' in doc.metadata['searchable_text']
        assert 'age: 30' in doc.metadata['searchable_text']
        
        # Check content is valid JSON
        parsed_content = json.loads(doc.page_content)
        assert parsed_content == json_data
        
    finally:
        Path(temp_path).unlink()


def test_json_array_extraction():
    """Test extraction of a JSON array with multiple objects."""
    json_data = [
        {"id": 1, "name": "Alice", "role": "developer"},
        {"id": 2, "name": "Bob", "role": "designer"},
        {"id": 3, "name": "Charlie", "role": "manager"}
    ]
    
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        json.dump(json_data, f, ensure_ascii=False, indent=2)
        temp_path = f.name
    
    try:
        extractor = JsonExtractor(temp_path)
        documents = extractor.extract()
        
        assert len(documents) == 3
        
        # Check first document
        doc1 = documents[0]
        assert doc1.metadata['source'] == temp_path
        assert doc1.metadata['index'] == 0
        assert doc1.metadata['type'] == 'dict'
        assert doc1.metadata['keys'] == ['id', 'name', 'role']
        assert 'name: Alice' in doc1.metadata['searchable_text']
        
        # Check second document
        doc2 = documents[1]
        assert doc2.metadata['index'] == 1
        assert 'name: Bob' in doc2.metadata['searchable_text']
        
        # Check third document
        doc3 = documents[2]
        assert doc3.metadata['index'] == 2
        assert 'name: Charlie' in doc3.metadata['searchable_text']
        
        # Verify content
        parsed_content1 = json.loads(doc1.page_content)
        assert parsed_content1 == json_data[0]
        
    finally:
        Path(temp_path).unlink()


def test_json_primitive_extraction():
    """Test extraction of primitive JSON values."""
    json_data = "Hello, World!"
    
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        json.dump(json_data, f, ensure_ascii=False)
        temp_path = f.name
    
    try:
        extractor = JsonExtractor(temp_path)
        documents = extractor.extract()
        
        assert len(documents) == 1
        doc = documents[0]
        
        assert doc.metadata['source'] == temp_path
        assert doc.metadata['type'] == 'primitive'
        assert doc.metadata['data_type'] == 'str'
        
        parsed_content = json.loads(doc.page_content)
        assert parsed_content == json_data
        
    finally:
        Path(temp_path).unlink()


def test_json_malformed_error():
    """Test error handling for malformed JSON."""
    malformed_json = '{"name": "John", "age": 30,}'
    
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        f.write(malformed_json)
        temp_path = f.name
    
    try:
        extractor = JsonExtractor(temp_path)
        
        # Should raise ValueError for malformed JSON
        try:
            extractor.extract()
            assert False, "Expected ValueError for malformed JSON"
        except ValueError as e:
            assert "Invalid JSON format" in str(e)
            assert temp_path in str(e)
            
    finally:
        Path(temp_path).unlink()


def test_json_with_file_content():
    """Test extraction using file_content parameter."""
    json_data = {"message": "Hello from bytes", "count": 42}
    json_bytes = json.dumps(json_data, ensure_ascii=False).encode('utf-8')
    
    extractor = JsonExtractor("dummy_path.json", json_bytes)
    documents = extractor.extract()
    
    assert len(documents) == 1
    doc = documents[0]
    
    assert doc.metadata['source'] == "dummy_path.json"
    assert doc.metadata['type'] == 'dict'
    assert 'message: Hello from bytes' in doc.metadata['searchable_text']
    
    parsed_content = json.loads(doc.page_content)
    assert parsed_content == json_data


def test_json_nested_array():
    """Test extraction of nested array structures."""
    json_data = [
        [1, 2, 3],
        ["a", "b", "c"],
        [True, False, None]
    ]
    
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        json.dump(json_data, f, ensure_ascii=False, indent=2)
        temp_path = f.name
    
    try:
        extractor = JsonExtractor(temp_path)
        documents = extractor.extract()
        
        assert len(documents) == 3
        
        # Check first array
        doc1 = documents[0]
        assert doc1.metadata['type'] == 'list'
        assert doc1.metadata['length'] == 3
        assert doc1.metadata['element_types'] == ['int']
        
        # Check second array
        doc2 = documents[1]
        assert doc2.metadata['element_types'] == ['str']
        
        # Check third array
        doc3 = documents[2]
        assert set(doc3.metadata['element_types']) == {'bool', 'NoneType'}
        
    finally:
        Path(temp_path).unlink()