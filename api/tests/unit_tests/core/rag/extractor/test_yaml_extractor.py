import tempfile
from pathlib import Path
import yaml

from core.rag.extractor.yaml_extractor import YamlExtractor


def test_yaml_object_extraction():
    """Test extraction of YAML object with multiple key-value pairs."""
    yaml_content = """
name: John Doe
age: 30
email: john@example.com
address:
  street: 123 Main St
  city: New York
  country: USA
skills:
  - Python
  - JavaScript
  - Docker
    """
    
    with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as temp_file:
        temp_file.write(yaml_content)
        temp_file_path = temp_file.name
    
    try:
        extractor = YamlExtractor(temp_file_path, autodetect_encoding=True)
        documents = extractor.extract()
        
        assert len(documents) == 1
        doc = documents[0]
        
        # Check metadata
        assert doc.metadata['source'] == temp_file_path
        assert doc.metadata['type'] == 'object'
        assert doc.metadata['index'] == 0
        assert doc.metadata['key_count'] == 5
        assert 'name' in doc.metadata['keys']
        assert 'age' in doc.metadata['keys']
        assert 'email' in doc.metadata['keys']
        assert 'address' in doc.metadata['keys']
        assert 'skills' in doc.metadata['keys']
        
        # Check content structure
        assert 'name: John Doe' in doc.page_content
        assert 'age: 30' in doc.page_content
        assert 'email: john@example.com' in doc.page_content
        assert 'address:' in doc.page_content
        assert 'skills:' in doc.page_content
        
    finally:
        Path(temp_file_path).unlink()


def test_yaml_array_extraction():
    """Test extraction of YAML array with multiple objects."""
    yaml_content = """
- name: Alice
  role: Developer
  experience: 5
- name: Bob
  role: Designer
  experience: 3
- name: Charlie
  role: Manager
  experience: 8
    """
    
    with tempfile.NamedTemporaryFile(mode='w', suffix='.yml', delete=False) as temp_file:
        temp_file.write(yaml_content)
        temp_file_path = temp_file.name
    
    try:
        extractor = YamlExtractor(temp_file_path, autodetect_encoding=True)
        documents = extractor.extract()
        
        assert len(documents) == 3
        
        # Check first document
        doc1 = documents[0]
        assert doc1.metadata['source'] == temp_file_path
        assert doc1.metadata['type'] == 'array_item'
        assert doc1.metadata['index'] == 0
        assert doc1.metadata['key_count'] == 3
        assert 'name' in doc1.metadata['keys']
        assert 'role' in doc1.metadata['keys']
        assert 'experience' in doc1.metadata['keys']
        assert 'name: Alice' in doc1.page_content
        assert 'role: Developer' in doc1.page_content
        
        # Check second document
        doc2 = documents[1]
        assert doc2.metadata['index'] == 1
        assert 'name: Bob' in doc2.page_content
        assert 'role: Designer' in doc2.page_content
        
        # Check third document
        doc3 = documents[2]
        assert doc3.metadata['index'] == 2
        assert 'name: Charlie' in doc3.page_content
        assert 'role: Manager' in doc3.page_content
        
    finally:
        Path(temp_file_path).unlink()


def test_yaml_mixed_content():
    """Test extraction of YAML with mixed content types."""
    yaml_content = """
version: 1.0
services:
  web:
    image: nginx
    ports:
      - "80:80"
      - "443:443"
  database:
    image: postgres
    environment:
      POSTGRES_DB: myapp
      POSTGRES_USER: user
volumes:
  - data:/var/lib/postgresql/data
    """
    
    with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as temp_file:
        temp_file.write(yaml_content)
        temp_file_path = temp_file.name
    
    try:
        extractor = YamlExtractor(temp_file_path, autodetect_encoding=True)
        documents = extractor.extract()
        
        assert len(documents) == 1
        doc = documents[0]
        
        # Check metadata
        assert doc.metadata['type'] == 'object'
        assert doc.metadata['key_count'] == 3
        assert 'version' in doc.metadata['keys']
        assert 'services' in doc.metadata['keys']
        assert 'volumes' in doc.metadata['keys']
        
        # Check nested structure preservation
        assert 'version: 1.0' in doc.page_content
        assert 'services:' in doc.page_content
        assert 'web:' in doc.page_content
        assert 'database:' in doc.page_content
        assert 'volumes:' in doc.page_content
        
    finally:
        Path(temp_file_path).unlink()


def test_yaml_simple_array():
    """Test extraction of simple YAML array."""
    yaml_content = """
- apple
- banana
- cherry
- date
    """
    
    with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as temp_file:
        temp_file.write(yaml_content)
        temp_file_path = temp_file.name
    
    try:
        extractor = YamlExtractor(temp_file_path, autodetect_encoding=True)
        documents = extractor.extract()
        
        assert len(documents) == 4
        
        # Check each item
        items = ['apple', 'banana', 'cherry', 'date']
        for i, item in enumerate(items):
            doc = documents[i]
            assert doc.metadata['type'] == 'array_item'
            assert doc.metadata['index'] == i
            assert doc.metadata['key_count'] == 0  # Simple values have no keys
            assert doc.metadata['keys'] == []
            assert doc.page_content.strip() == item
            
    finally:
        Path(temp_file_path).unlink()


def test_yaml_empty_file():
    """Test extraction of empty YAML file."""
    yaml_content = ""
    
    with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as temp_file:
        temp_file.write(yaml_content)
        temp_file_path = temp_file.name
    
    try:
        extractor = YamlExtractor(temp_file_path, autodetect_encoding=True)
        documents = extractor.extract()
        
        assert len(documents) == 0
        
    finally:
        Path(temp_file_path).unlink()


def test_yaml_malformed_content():
    """Test extraction of malformed YAML content."""
    yaml_content = """
name: John
  invalid_indentation: value
age: 30
    invalid: structure
    """
    
    with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as temp_file:
        temp_file.write(yaml_content)
        temp_file_path = temp_file.name
    
    try:
        extractor = YamlExtractor(temp_file_path, autodetect_encoding=True)
        
        # Should raise an exception for malformed YAML
        try:
            documents = extractor.extract()
            assert False, "Expected an exception for malformed YAML"
        except (RuntimeError, yaml.YAMLError):
            # This is expected behavior
            pass
        
    finally:
        Path(temp_file_path).unlink()


def test_yaml_unicode_content():
    """Test extraction of YAML with Unicode content."""
    yaml_content = """
name: 张三
age: 25
city: 北京
description: 这是一个测试用户
languages:
  - 中文
  - English
  - 日本語
    """
    
    with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False, encoding='utf-8') as temp_file:
        temp_file.write(yaml_content)
        temp_file_path = temp_file.name
    
    try:
        extractor = YamlExtractor(temp_file_path, autodetect_encoding=True)
        documents = extractor.extract()
        
        assert len(documents) == 1
        doc = documents[0]
        
        # Check Unicode content preservation
        assert 'name: 张三' in doc.page_content
        assert 'city: 北京' in doc.page_content
        assert 'description: 这是一个测试用户' in doc.page_content
        assert '中文' in doc.page_content
        assert '日本語' in doc.page_content
        
    finally:
        Path(temp_file_path).unlink()