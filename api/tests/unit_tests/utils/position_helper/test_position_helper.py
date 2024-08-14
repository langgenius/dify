from textwrap import dedent

import pytest

from core.helper.position_helper import get_position_map


@pytest.fixture
def prepare_example_positions_yaml(tmp_path, monkeypatch) -> str:
    monkeypatch.chdir(tmp_path)
    tmp_path.joinpath("example_positions.yaml").write_text(dedent(
        """\
        - first
        - second
        # - commented
        - third
        
        - 9999999999999
        - forth
        """))
    return str(tmp_path)


@pytest.fixture
def prepare_empty_commented_positions_yaml(tmp_path, monkeypatch) -> str:
    monkeypatch.chdir(tmp_path)
    tmp_path.joinpath("example_positions_all_commented.yaml").write_text(dedent(
        """\
        # - commented1
        # - commented2
        - 
        -   
        
        """))
    return str(tmp_path)


def test_position_helper(prepare_example_positions_yaml):
    position_map = get_position_map(
        folder_path=prepare_example_positions_yaml,
        file_name='example_positions.yaml')
    assert len(position_map) == 4
    assert position_map == {
        'first': 0,
        'second': 1,
        'third': 2,
        'forth': 3,
    }


def test_position_helper_with_all_commented(prepare_empty_commented_positions_yaml):
    position_map = get_position_map(
        folder_path=prepare_empty_commented_positions_yaml,
        file_name='example_positions_all_commented.yaml')
    assert position_map == {}
