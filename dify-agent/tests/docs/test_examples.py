from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path

import pytest
from _pytest.mark import ParameterSet
from pytest_examples import CodeExample, EvalExample, find_examples
from pytest_examples.config import ExamplesConfig as BaseExamplesConfig


@dataclass
class ExamplesConfig(BaseExamplesConfig):
    known_first_party: list[str] = field(default_factory=list[str])

    def ruff_config(self) -> tuple[str, ...]:
        config = super().ruff_config()
        if self.known_first_party:
            config = (*config, "--config", f"lint.isort.known-first-party = {self.known_first_party}")
        return config


def find_doc_examples() -> Iterable[ParameterSet]:
    root_dir = Path(__file__).resolve().parents[2]
    for example in find_examples(
        root_dir / "docs",
        root_dir / "src",
        root_dir / "examples" / "agenton",
        root_dir / "examples" / "dify_agent",
    ):
        path = example.path.relative_to(root_dir)
        yield pytest.param(example, id=f"{path}:{example.start_line}")


@pytest.mark.parametrize("example", find_doc_examples())
def test_documentation_examples(example: CodeExample, eval_example: EvalExample) -> None:
    prefix_settings = example.prefix_settings()
    opt_test = prefix_settings.get("test", "")
    opt_lint = prefix_settings.get("lint", "")
    line_length = int(prefix_settings.get("line_length", "120"))

    eval_example.config = ExamplesConfig(
        ruff_ignore=["D", "Q001"],
        target_version="py312",  # pyright: ignore[reportArgumentType]
        line_length=line_length,
        isort=True,
        upgrade=True,
        quotes="double",
        known_first_party=["agenton", "agenton_collections", "dify_agent"],
    )

    if not opt_lint.startswith("skip"):
        if eval_example.update_examples:  # pragma: no cover
            eval_example.format_ruff(example)
        else:
            eval_example.lint_ruff(example)

    if opt_test.startswith("skip"):
        pytest.skip(opt_test[4:].lstrip(" -") or "running code skipped")

    if eval_example.update_examples:  # pragma: no cover
        eval_example.run_print_update(example, module_globals={"__name__": "__main__"})
    else:
        eval_example.run_print_check(example, module_globals={"__name__": "__main__"})
