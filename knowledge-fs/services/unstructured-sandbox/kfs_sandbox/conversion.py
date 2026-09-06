"""Version-scoped executable adapters: validate privately, then publish.

Supported invocations are the pinned Unstructured DOC/PPT and RTF/EPUB/ODT paths.
No provider Python function is replaced. Every converter shares the original mail
admission budget via one file-locked ledger in its disposable request directory.
"""

from __future__ import annotations

import fcntl
import heapq
import json
import os
import subprocess
import tempfile
import time
from dataclasses import asdict, dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import BinaryIO

from .admission import Budget, Limits, Rejected, inspect_document


PROBES = {"--version", "--list-input-formats", "--list-output-formats"}
VOID_TAGS = frozenset(
    "area base br col embed hr img input link meta param source track wbr".split()
)
MAX_PRODUCT_BYTES = 64 * 1024 * 1024


def initialize_budget(directory: Path, budget: Budget, *, wall_seconds: float) -> None:
    state = {
        "budget": asdict(budget),
        "failure": None,
        "deadline": time.monotonic() + wall_seconds,
    }
    (directory / "conversion-budget.json").write_text(json.dumps(state))


def _decode_state(handle) -> tuple[dict, Budget]:
    handle.seek(0)
    raw = handle.read(16 * 1024 + 1)
    if len(raw) > 16 * 1024:
        raise Rejected("archive_invalid")
    state = json.loads(raw)
    values = dict(state["budget"])
    limits = Limits(**values.pop("limits"))
    return state, Budget(limits=limits, **values)


def load_budget(directory: Path) -> tuple[Budget, str | None]:
    with (directory / "conversion-budget.json").open("rb") as handle:
        fcntl.flock(handle, fcntl.LOCK_SH)
        state, budget = _decode_state(handle)
        return budget, state["failure"]


def record_failure(directory: Path, reason: str) -> None:
    with (directory / "conversion-budget.json").open("r+b") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        state, _ = _decode_state(handle)
        state["failure"] = state["failure"] or reason
        handle.seek(0)
        handle.write(json.dumps(state).encode())
        handle.truncate()
        handle.flush()


def _record_product(directory: Path, body: bytes, target_format: str) -> None:
    with (directory / "conversion-budget.json").open("r+b") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        state, budget = _decode_state(handle)
        try:
            if state["failure"]:
                raise Rejected(state["failure"])
            budget.consume("decoded_bytes", len(body))
            if target_format == "html":
                budget.consume("expanded_bytes", len(body))
                budget.consume("xml_bytes", len(body))
                if len(body) > budget.limits.xml_member_bytes:
                    raise Rejected("xml_member_bytes")
                try:
                    text = body.decode("utf-8", errors="strict")
                except UnicodeDecodeError as error:
                    raise Rejected("archive_invalid") from error
                guard = _HtmlGuard(budget)
                guard.feed(text)
                guard.close()
            else:
                inspect_document(body, f"converted.{target_format}", budget)
        except Rejected as error:
            state["failure"] = error.reason
            raise
        finally:
            state["budget"] = asdict(budget)
            encoded = json.dumps(state).encode()
            handle.seek(0)
            handle.write(encoded)
            handle.truncate()
            handle.flush()


def _inside(path: str | Path, directory: Path, *, existing: bool) -> Path:
    target = Path(path)
    resolved = target.resolve(strict=existing)
    if not resolved.is_relative_to(directory.resolve()) or target.is_symlink():
        raise Rejected("archive_path")
    if existing and not resolved.is_file():
        raise Rejected("archive_path")
    return resolved


@dataclass(frozen=True)
class Invocation:
    arguments: tuple[str, ...]
    target_format: str
    source: Path | None = None
    output: Path | None = None
    probe: bool = False


def parse_invocation(kind: str, arguments: list[str], directory: Path) -> Invocation:
    if kind == "pandoc" and len(arguments) == 1 and arguments[0] in PROBES:
        return Invocation(tuple(arguments), "probe", probe=True)
    if kind == "soffice":
        if (
            len(arguments) != 6
            or arguments[0:2] != ["--headless", "--convert-to"]
            or arguments[3] != "--outdir"
        ):
            raise Rejected("archive_invalid")
        target_format = arguments[2].split(":", 1)[0]
        if target_format not in {"docx", "pptx"}:
            raise Rejected("archive_invalid")
        source = _inside(arguments[5], directory, existing=True)
        output = _inside(
            Path(arguments[4]) / f"{source.stem}.{target_format}",
            directory,
            existing=False,
        )
    elif kind == "pandoc":
        values: dict[str, str] = {}
        sources = []
        sandbox = False
        for argument in arguments:
            if argument == "--sandbox" and not sandbox:
                sandbox = True
            elif argument.startswith(("--from=", "--to=", "--output=")):
                key, value = argument.split("=", 1)
                if key in values or not value:
                    raise Rejected("archive_invalid")
                values[key] = value
            elif not argument.startswith("-"):
                sources.append(argument)
            else:
                raise Rejected("archive_invalid")
        if len(sources) != 1 or values.get("--from") not in {"rtf", "epub", "odt"}:
            raise Rejected("archive_invalid")
        source = _inside(sources[0], directory, existing=True)
        target_format = values.get("--to", "")
        output_arg = values.get("--output")
        if target_format == "html" and output_arg is None:
            output = None
        elif target_format == "docx" and values["--from"] == "odt" and output_arg:
            output = _inside(output_arg, directory, existing=False)
        else:
            raise Rejected("archive_invalid")
    else:
        raise Rejected("archive_invalid")
    if output is not None and output.exists():
        raise Rejected("archive_path")
    return Invocation(tuple(arguments), target_format, source, output)


def _run(
    command: list[str], stdout_path: Path, stderr_path: Path, deadline: float, cap: int
) -> int:
    # Inherit the request process group and all rlimits. Never detach a converter.
    with stdout_path.open("wb") as stdout, stderr_path.open("wb") as stderr:
        process = subprocess.Popen(
            command, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr
        )
        try:
            while process.poll() is None:
                if (
                    stdout_path.stat().st_size > cap
                    or stderr_path.stat().st_size > 64 * 1024
                ):
                    raise Rejected("xml_member_bytes")
                if time.monotonic() >= deadline:
                    raise Rejected("wall_seconds")
                time.sleep(0.01)
            if (
                stdout_path.stat().st_size > cap
                or stderr_path.stat().st_size > 64 * 1024
            ):
                raise Rejected("xml_member_bytes")
            if process.returncode < 0:
                # Inherited CPU/file limits and OS termination must not become an
                # attachment silently skipped by an upstream exception handler.
                raise Rejected("worker_resource_limit")
            return process.returncode
        finally:
            if process.poll() is None:
                process.kill()
            process.wait()


def _read_bounded(path: Path, cap: int) -> bytes:
    with path.open("rb") as handle:
        body = handle.read(cap + 1)
    if len(body) > cap:
        raise Rejected("xml_member_bytes")
    return body


def convert(
    kind: str,
    arguments: list[str],
    directory: Path,
    executable: list[str],
    stdout: BinaryIO,
    stderr: BinaryIO,
    *,
    max_product_bytes: int = MAX_PRODUCT_BYTES,
) -> int:
    try:
        return _convert(
            kind,
            arguments,
            directory,
            executable,
            stdout,
            stderr,
            max_product_bytes=max_product_bytes,
        )
    except Rejected as error:
        record_failure(directory, error.reason)
        raise


def _convert(
    kind: str,
    arguments: list[str],
    directory: Path,
    executable: list[str],
    stdout: BinaryIO,
    stderr: BinaryIO,
    *,
    max_product_bytes: int,
) -> int:
    invocation = parse_invocation(kind, arguments, directory)
    with (directory / "conversion-budget.json").open("rb") as handle:
        fcntl.flock(handle, fcntl.LOCK_SH)
        state, _ = _decode_state(handle)
    if state["failure"]:
        raise Rejected(state["failure"])
    with tempfile.TemporaryDirectory(prefix="convert-", dir=directory) as temporary:
        stage = Path(temporary)
        staged_output = None
        adapted = list(invocation.arguments)
        if invocation.output is not None:
            staged_output = stage / invocation.output.name
            if kind == "soffice":
                adapted[4] = str(stage)
            else:
                adapted = [
                    f"--output={staged_output}" if arg.startswith("--output=") else arg
                    for arg in adapted
                ]
        output_path, error_path = stage / "stdout", stage / "stderr"
        code = _run(
            [*executable, *adapted],
            output_path,
            error_path,
            state["deadline"],
            64 * 1024 if invocation.probe else max_product_bytes,
        )
        if code == 0 and not invocation.probe:
            product = staged_output or output_path
            if not product.is_file() or product.is_symlink():
                raise Rejected("archive_invalid")
            if product.stat().st_size > max_product_bytes:
                raise Rejected("xml_member_bytes")
            _record_product(
                directory,
                _read_bounded(product, max_product_bytes),
                invocation.target_format,
            )
            if staged_output is not None:
                # Only publish a validated file; neither rejected nor partial converter
                # products ever appear at the path the upstream parser will open.
                try:
                    # Same request tmpfs: link is an atomic publish-if-absent operation,
                    # unlike replace(), which could clobber a concurrently created file.
                    os.link(staged_output, invocation.output, follow_symlinks=False)
                except FileExistsError as error:
                    raise Rejected("archive_path") from error
        stdout.write(
            _read_bounded(
                output_path, 64 * 1024 if invocation.probe else max_product_bytes
            )
        )
        stderr.write(_read_bounded(error_path, 64 * 1024))
        return code


class _HtmlGuard(HTMLParser):
    def __init__(self, budget: Budget):
        super().__init__(convert_charrefs=False)
        self.budget = budget
        self.stack: list[str] = []
        self.tables: list[dict] = []

    def handle_starttag(
        self, tag: str, attributes: list[tuple[str, str | None]]
    ) -> None:
        self.budget.consume("xml_nodes")
        if tag not in VOID_TAGS:
            self.stack.append(tag)
            if len(self.stack) > self.budget.limits.xml_depth:
                raise Rejected("xml_depth")
        if tag == "table":
            self.tables.append(
                {
                    "row": 0,
                    "column": 0,
                    "width": 0,
                    "height": 0,
                    "occupied": 0,
                    "spans": [],
                }
            )
        if not self.tables:
            return
        table = self.tables[-1]
        if tag == "tr":
            table["row"] += 1
            table["column"] = 0
            while table["spans"] and table["spans"][0][0] < table["row"]:
                _, mask = heapq.heappop(table["spans"])
                table["occupied"] &= ~mask
        elif tag in {"td", "th"}:
            attrs = dict(attributes)
            if len(attrs) != len(attributes):
                raise Rejected("archive_invalid")
            rows, columns = (
                self._span(attrs.get("rowspan")),
                self._span(attrs.get("colspan")),
            )
            if (
                rows > self.budget.limits.sheet_rows
                or columns > self.budget.limits.sheet_columns
            ):
                raise Rejected("sheet_extent")
            row = max(1, table["row"])
            column = table["column"]
            while occupied := (table["occupied"] >> column) & ((1 << columns) - 1):
                column += occupied.bit_length()
            end = column + columns
            height = max(table["height"], row + rows - 1)
            width = max(table["width"], end)
            if (
                width > self.budget.limits.sheet_columns
                or height > self.budget.limits.sheet_rows
            ):
                raise Rejected("sheet_extent")
            cells = height * width
            if cells > self.budget.limits.sheet_cells:
                raise Rejected("sheet_cells")
            self.budget.consume(
                "workbook_cells", cells - table["height"] * table["width"]
            )
            table.update(column=end, height=height, width=width)
            if rows > 1:
                mask = ((1 << columns) - 1) << column
                table["occupied"] |= mask
                heapq.heappush(table["spans"], (row + rows - 1, mask))

    @staticmethod
    def _span(value: str | None) -> int:
        if value is None:
            return 1
        if (
            not value.isascii()
            or not value.isdigit()
            or not 0 < len(value) <= 7
            or int(value) < 1
        ):
            raise Rejected("sheet_extent")
        return int(value)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID_TAGS:
            self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        if tag == "table" and self.tables:
            self.tables.pop()
        if tag in self.stack:
            del self.stack[len(self.stack) - 1 - self.stack[::-1].index(tag) :]
