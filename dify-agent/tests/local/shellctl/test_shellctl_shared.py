import re
from datetime import UTC, datetime
from pathlib import Path

import pytest
from pydantic import ValidationError

from shellctl.shared import (
    JOB_ID_ALPHABET,
    RunJobRequest,
    generate_job_id,
    read_output_window,
    tail_output_window,
)


def test_generate_job_id_matches_proposal_format() -> None:
    job_id = generate_job_id(now=datetime(2026, 5, 21, 15, 30, tzinfo=UTC))

    assert re.fullmatch(r"05211530-[0-9abcdefghjkmnpqrstvwxyz]{3}", job_id)
    assert all(char in f"{JOB_ID_ALPHABET}-" for char in job_id[9:])


def test_read_output_window_preserves_utf8_boundaries(tmp_path: Path) -> None:
    output_path = tmp_path / "output.log"
    output_path.write_text("A🙂B", encoding="utf-8")

    first = read_output_window(output_path, offset=0, limit=3)
    second = read_output_window(output_path, offset=first.offset, limit=4)
    third = read_output_window(output_path, offset=second.offset, limit=8)

    assert first.output == "A"
    assert first.offset == 1
    assert first.truncated is True
    assert second.output == "🙂"
    assert second.offset == 5
    assert second.truncated is True
    assert third.output == "B"
    assert third.offset == output_path.stat().st_size
    assert third.truncated is False


def test_read_output_window_advances_past_wide_char_even_when_limit_is_smaller(
    tmp_path: Path,
) -> None:
    output_path = tmp_path / "output.log"
    output_path.write_text("🙂B", encoding="utf-8")

    first = read_output_window(output_path, offset=0, limit=1)
    second = read_output_window(output_path, offset=first.offset, limit=1)

    assert first.output == "🙂"
    assert first.offset == len("🙂".encode())
    assert first.truncated is True
    assert second.output == "B"
    assert second.truncated is False


def test_tail_output_window_skips_partial_utf8_prefix(tmp_path: Path) -> None:
    output_path = tmp_path / "output.log"
    output_path.write_text("a🙂b", encoding="utf-8")

    tail = tail_output_window(output_path, limit=3)

    assert tail.output == "b"
    assert tail.offset == output_path.stat().st_size
    assert tail.truncated is False


@pytest.mark.parametrize(
    ("env", "message"),
    [
        ({"": "x"}, "non-empty"),
        ({"A=B": "x"}, "must not contain '='"),
        ({"A\x00B": "x"}, "must not contain NUL"),
        ({"A": "x\x00y"}, "must not contain NUL"),
    ],
)
def test_run_job_request_rejects_invalid_env_entries(env: dict[str, str], message: str) -> None:
    with pytest.raises(ValidationError, match=message):
        RunJobRequest(script="printf ready\n", env=env)
