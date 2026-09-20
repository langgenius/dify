"""Keep early CI sharding complete, disjoint, and independent of input order."""

from pathlib import Path

import pytest

from dev.pytest_sharding import main, select_test_files


def test_file_shards_cover_each_test_file_once(tmp_path: Path) -> None:
    unit = tmp_path / "unit"
    provider = tmp_path / "provider"
    controllers = unit / "controllers"
    expected = {
        unit / "test_a.py",
        unit / "nested" / "test_b.py",
        unit / "nested" / "feature_test.py",
        provider / "test_a.py",
        provider / "test_c.py",
    }
    for path in expected | {controllers / "test_controller.py", unit / "conftest.py", unit / "helper.py"}:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.touch()

    shards = [
        select_test_files([unit, provider, unit], shard_index=i, shard_total=3, ignored=[controllers])
        for i in range(1, 4)
    ]
    selected = [path for shard in shards for path in shard]
    assert len(selected) == len(set(selected))
    assert set(selected) == expected
    assert max(map(len, shards)) - min(map(len, shards)) <= 1
    assert shards[1] == select_test_files([provider, unit], shard_index=2, shard_total=3, ignored=[controllers])


@pytest.mark.parametrize(("index", "total"), [(0, 3), (4, 3), (1, 0), (1, -1)])
def test_rejects_invalid_shard(tmp_path: Path, index: int, total: int) -> None:
    with pytest.raises(ValueError, match="shard-index"):
        select_test_files([tmp_path], shard_index=index, shard_total=total)


def test_empty_shard_fails_instead_of_running_default_discovery(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr("sys.argv", ["pytest_sharding.py", "--shard-index", "1", "--shard-total", "3", str(tmp_path)])
    with pytest.raises(SystemExit) as exc:
        main()
    assert exc.value.code == 2
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "No test files selected" in captured.err
