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


def test_duration_plan_balances_work_and_ignores_stale_history() -> None:
    from dev.pytest_sharding import build_plan

    files = [Path(f"test_{name}.py") for name in "abcd"]
    durations = dict(zip((str(path) for path in files), [90.0, 80.0, 50.0, 40.0], strict=True))
    durations["deleted.py"] = 999.0
    plan = build_plan(files, durations, total=2, threshold=120)
    assert set(plan) == {str(path) for path in files}
    loads = [sum(durations[name] for name, targets in plan.items() if targets == [i]) for i in (1, 2)]
    assert loads == [130, 130]
    assert plan == build_plan(list(reversed(files)), durations, total=2, threshold=120)


def test_logical_shards_cover_existing_and_new_cases_exactly_once() -> None:
    from dev.pytest_sharding import build_plan, case_shard

    plan = build_plan([Path("test_large.py")], {"test_large.py": 250.0}, total=3, threshold=100)
    targets = plan["test_large.py"]
    assert sorted(targets) == [1, 2, 3]
    cases = [f"TestLarge::test_case[param-{i}]" for i in range(100)] + ["test_new"]
    partitions = [{case for case in cases if case_shard(case, targets) == shard} for shard in (1, 2, 3)]
    assert set.union(*partitions) == set(cases)
    assert sum(map(len, partitions)) == len(cases)
    assert all(partitions)


def test_missing_or_corrupt_history_keeps_all_files(tmp_path: Path) -> None:
    from dev.pytest_sharding import build_plan, load_durations

    path = tmp_path / "durations.json"
    assert load_durations(path) == {}
    for invalid in ["broken", "[]", "null"]:
        path.write_text(invalid)
        assert load_durations(path) == {}
    path.write_text('{"good": 2, "negative": -1, "nan": NaN, "bool": true, "string": "2"}')
    assert load_durations(path) == {"good": 2.0}
    files = [Path(f"test_{i}.py") for i in range(5)]
    assert list(build_plan(files, {}, total=2, threshold=60).values()) == [[1], [2], [1], [2], [1]]


def test_plan_cli_selects_only_files_assigned_to_shard(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    import json

    plan = tmp_path / "plan.json"
    plan.write_text(json.dumps({"api/test_a.py": [1], "api/test_b.py": [2], "api/test_big.py": [1, 2]}))
    monkeypatch.setattr(
        "sys.argv", ["pytest_sharding.py", "--shard-index", "2", "--shard-total", "2", "--plan", str(plan), "api"]
    )
    main()
    assert capsys.readouterr().out.splitlines() == ["api/test_b.py", "api/test_big.py"]


@pytest.mark.parametrize("with_history", [False, True])
def test_cli_freezes_current_files_and_every_shard_consumes_the_same_plan(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], with_history: bool
) -> None:
    import json

    root = tmp_path / "tests"
    root.mkdir()
    slow = root / "test_slow.py"
    new = root / "test_new.py"
    for path in (slow, new, root / "helper.py"):
        path.touch()
    history = tmp_path / "history.json"
    history.write_text(json.dumps({str(slow): 100, str(root / "test_deleted.py"): 1000}))
    plan_path = tmp_path / "plan.json"
    arguments = ["pytest_sharding.py", "--shard-index", "1", "--shard-total", "2", "--write-plan", str(plan_path)]
    if with_history:
        arguments.extend(["--durations", str(history)])
    monkeypatch.setattr("sys.argv", [*arguments, str(root)])
    main()
    assert capsys.readouterr().out == ""
    plan = json.loads(plan_path.read_text())
    assert set(plan) == {str(slow), str(new)}
    if with_history:
        assert sorted(plan[str(slow)]) == [1, 2]
    selected: set[str] = set()
    for shard in (1, 2):
        monkeypatch.setattr(
            "sys.argv",
            [
                "pytest_sharding.py",
                "--shard-index",
                str(shard),
                "--shard-total",
                "2",
                "--plan",
                str(plan_path),
                str(root),
            ],
        )
        main()
        files = capsys.readouterr().out.splitlines()
        assert set(files) == {name for name, targets in plan.items() if shard in targets}
        selected.update(files)
    assert selected == {str(slow), str(new)}


@pytest.mark.parametrize("threshold", [0, -1, float("nan")])
def test_invalid_logical_split_threshold_is_rejected(threshold: float) -> None:
    from dev.pytest_sharding import build_plan

    with pytest.raises(ValueError, match="positive"):
        build_plan([Path("test_a.py")], {"test_a.py": 10.0}, total=2, threshold=threshold)
