from textwrap import dedent

import pytest
from yaml import YAMLError

from core.tools.utils.yaml_utils import load_yaml_file

EXAMPLE_YAML_FILE = "example_yaml.yaml"
INVALID_YAML_FILE = "invalid_yaml.yaml"
NON_EXISTING_YAML_FILE = "non_existing_file.yaml"


@pytest.fixture()
def prepare_example_yaml_file(tmp_path, monkeypatch) -> str:
    monkeypatch.chdir(tmp_path)
    file_path = tmp_path.joinpath(EXAMPLE_YAML_FILE)
    file_path.write_text(
        dedent(
            """\
        address:
            city: Example City
            country: Example Country
        age: 30
        gender: male
        languages:
            - Python
            - Java
            - C++
        empty_key:
        """
        )
    )
    return str(file_path)


@pytest.fixture()
def prepare_invalid_yaml_file(tmp_path, monkeypatch) -> str:
    monkeypatch.chdir(tmp_path)
    file_path = tmp_path.joinpath(INVALID_YAML_FILE)
    file_path.write_text(
        dedent(
            """\
        address:
                   city: Example City
            country: Example Country
        age: 30
        gender: male
        languages:
        - Python
        - Java
        - C++
        """
        )
    )
    return str(file_path)


def test_load_yaml_non_existing_file():
    assert load_yaml_file(file_path=NON_EXISTING_YAML_FILE) == {}
    assert load_yaml_file(file_path="") == {}

    with pytest.raises(FileNotFoundError):
        load_yaml_file(file_path=NON_EXISTING_YAML_FILE, ignore_error=False)


def test_load_valid_yaml_file(prepare_example_yaml_file):
    yaml_data = load_yaml_file(file_path=prepare_example_yaml_file)
    assert len(yaml_data) > 0
    assert yaml_data["age"] == 30
    assert yaml_data["gender"] == "male"
    assert yaml_data["address"]["city"] == "Example City"
    assert set(yaml_data["languages"]) == {"Python", "Java", "C++"}
    assert yaml_data.get("empty_key") is None
    assert yaml_data.get("non_existed_key") is None


def test_load_invalid_yaml_file(prepare_invalid_yaml_file):
    # yaml syntax error
    with pytest.raises(YAMLError):
        load_yaml_file(file_path=prepare_invalid_yaml_file, ignore_error=False)

    # ignore error
    assert load_yaml_file(file_path=prepare_invalid_yaml_file) == {}
