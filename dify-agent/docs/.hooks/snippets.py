from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SNIPPET_DIRECTIVE_PATTERN = re.compile(r"^```snippet\s+\{[^}]+\}\s*(?:```|\n```)$", re.MULTILINE)


@dataclass(frozen=True, slots=True)
class SnippetDirective:
    path: str
    title: str | None = None
    fragment: str | None = None
    highlight: str | None = None
    extra_attrs: dict[str, str] | None = None


@dataclass(frozen=True, slots=True)
class LineRange:
    start_line: int
    end_line: int

    def intersection(self, ranges: list[LineRange]) -> list[LineRange]:
        intersections: list[LineRange] = []
        for line_range in ranges:
            start_line = max(self.start_line, line_range.start_line)
            end_line = min(self.end_line, line_range.end_line)
            if start_line < end_line:
                intersections.append(LineRange(start_line, end_line))
        return intersections

    @staticmethod
    def merge(ranges: list[LineRange]) -> list[LineRange]:
        if not ranges:
            return []

        merged: list[LineRange] = []
        for line_range in sorted(ranges, key=lambda item: item.start_line):
            if not merged or merged[-1].end_line < line_range.start_line:
                merged.append(line_range)
            else:
                previous = merged[-1]
                merged[-1] = LineRange(previous.start_line, max(previous.end_line, line_range.end_line))
        return merged


@dataclass(frozen=True, slots=True)
class RenderedSnippet:
    content: str
    highlights: list[LineRange]
    original_range: LineRange


@dataclass(frozen=True, slots=True)
class ParsedFile:
    lines: list[str]
    sections: dict[str, list[LineRange]]
    lines_mapping: dict[int, int]

    def render(self, fragment_sections: list[str], highlight_sections: list[str]) -> RenderedSnippet:
        fragment_ranges: list[LineRange] = []
        if fragment_sections:
            for section_name in fragment_sections:
                fragment_ranges.extend(_section_ranges(self.sections, section_name))
            fragment_ranges = LineRange.merge(fragment_ranges)
        else:
            fragment_ranges = [LineRange(0, len(self.lines))]

        highlight_ranges: list[LineRange] = []
        for section_name in highlight_sections:
            highlight_ranges.extend(_section_ranges(self.sections, section_name))
        highlight_ranges = LineRange.merge(highlight_ranges)

        rendered_highlights: list[LineRange] = []
        rendered_lines: list[str] = []
        last_end_line = 0
        current_line = 0
        for fragment_range in fragment_ranges:
            if fragment_range.start_line > last_end_line:
                rendered_lines.append("..." if current_line == 0 else "\n...")
                current_line += 1

            for highlight_range in fragment_range.intersection(highlight_ranges):
                rendered_highlights.append(
                    LineRange(
                        highlight_range.start_line - fragment_range.start_line + current_line,
                        highlight_range.end_line - fragment_range.start_line + current_line,
                    )
                )

            for line_number in range(fragment_range.start_line, fragment_range.end_line):
                rendered_lines.append(self.lines[line_number])
                current_line += 1
            last_end_line = fragment_range.end_line

        if last_end_line < len(self.lines):
            rendered_lines.append("\n...")

        return RenderedSnippet(
            content="\n".join(rendered_lines),
            highlights=LineRange.merge(rendered_highlights),
            original_range=LineRange(
                self.lines_mapping[fragment_ranges[0].start_line],
                self.lines_mapping[fragment_ranges[-1].end_line - 1] + 1,
            ),
        )


def parse_snippet_directive(line: str) -> SnippetDirective | None:
    match = re.fullmatch(r"```snippet\s+\{([^}]+)\}\s*(?:```|\n```)", line.strip())
    if not match:
        return None

    attrs = {key: value for key, value in re.findall(r'(\w+)="([^"]*)"', match.group(1))}
    if "path" not in attrs:
        raise ValueError('Missing required key "path" in snippet directive')

    extra_attrs = {key: value for key, value in attrs.items() if key not in {"path", "title", "fragment", "highlight"}}
    return SnippetDirective(
        path=attrs["path"],
        title=attrs.get("title"),
        fragment=attrs.get("fragment"),
        highlight=attrs.get("highlight"),
        extra_attrs=extra_attrs or None,
    )


def parse_file_sections(file_path: Path) -> ParsedFile:
    input_lines = file_path.read_text(encoding="utf-8").splitlines()
    output_lines: list[str] = []
    lines_mapping: dict[int, int] = {}
    sections: dict[str, list[LineRange]] = {}
    section_starts: dict[str, int] = {}

    output_line_number = 0
    for source_line_number, line in enumerate(input_lines):
        section_match = re.search(r"\s*(?:###|///)\s*\[([^]]+)]\s*$", line)
        if section_match is None:
            output_lines.append(line)
            lines_mapping[output_line_number] = source_line_number
            output_line_number += 1
            continue

        line_before_marker = line[: section_match.start()]
        for section_name in section_match.group(1).split(","):
            section_name = section_name.strip()
            if section_name.startswith("/"):
                start_line = section_starts.pop(section_name[1:], None)
                if start_line is None:
                    raise ValueError(f"Cannot end unstarted section {section_name!r} at {file_path}")
                end_line = output_line_number + 1 if line_before_marker else output_line_number
                sections.setdefault(section_name[1:], []).append(LineRange(start_line, end_line))
            else:
                if section_name in section_starts:
                    raise ValueError(f"Cannot nest section {section_name!r} at {file_path}")
                section_starts[section_name] = output_line_number

        if line_before_marker:
            output_lines.append(line_before_marker)
            lines_mapping[output_line_number] = source_line_number
            output_line_number += 1

    if section_starts:
        raise ValueError(f"Some sections were not finished in {file_path}: {list(section_starts)}")

    return ParsedFile(lines=output_lines, sections=sections, lines_mapping=lines_mapping)


def format_highlight_lines(highlight_ranges: list[LineRange]) -> str:
    parts: list[str] = []
    for highlight_range in highlight_ranges:
        start_line = highlight_range.start_line + 1
        end_line = highlight_range.end_line
        parts.append(str(start_line) if start_line == end_line else f"{start_line}-{end_line}")
    return " ".join(parts)


def inject_snippets(markdown: str, relative_path_root: Path) -> str:
    def replace_snippet(match: re.Match[str]) -> str:
        directive = parse_snippet_directive(match.group(0))
        if directive is None:
            return match.group(0)

        file_path = _resolve_snippet_path(directive.path, relative_path_root)
        parsed_file = parse_file_sections(file_path)
        rendered = parsed_file.render(
            directive.fragment.split() if directive.fragment else [],
            directive.highlight.split() if directive.highlight else [],
        )

        attrs: list[str] = []
        title = directive.title or _default_title(file_path, rendered.original_range, bool(directive.fragment))
        if title:
            attrs.append(f'title="{title}"')
        if rendered.highlights:
            attrs.append(f'hl_lines="{format_highlight_lines(rendered.highlights)}"')
        if directive.extra_attrs:
            attrs.extend(f'{key}="{value}"' for key, value in directive.extra_attrs.items())

        attrs_text = f" {{{' '.join(attrs)}}}" if attrs else ""
        file_extension = file_path.suffix.lstrip(".") or "text"
        return f"```{file_extension}{attrs_text}\n{rendered.content}\n```"

    return SNIPPET_DIRECTIVE_PATTERN.sub(replace_snippet, markdown)


def _section_ranges(sections: dict[str, list[LineRange]], section_name: str) -> list[LineRange]:
    if section_name not in sections:
        raise ValueError(f"Unrecognized snippet section {section_name!r}; expected one of {list(sections)}")
    return sections[section_name]


def _resolve_snippet_path(path: str, relative_path_root: Path) -> Path:
    file_path = (REPO_ROOT / path[1:]).resolve() if path.startswith("/") else (relative_path_root / path).resolve()
    if not file_path.exists():
        raise FileNotFoundError(f"Snippet file {file_path} not found")
    if not file_path.is_relative_to(REPO_ROOT):
        raise ValueError(f"Snippet file {file_path} must be inside {REPO_ROOT}")
    return file_path


def _default_title(file_path: Path, original_range: LineRange, has_fragment: bool) -> str:
    relative_path = file_path.relative_to(REPO_ROOT)
    if not has_fragment:
        return str(relative_path)
    return f"{relative_path} (L{original_range.start_line + 1}-L{original_range.end_line})"
