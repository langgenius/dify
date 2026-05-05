#!/usr/bin/env python3
from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import re
import shutil
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PROCESSED_ROOT = ROOT / "volumes" / "knowledge" / "processed"
DEFAULT_OUTPUT_ROOT = ROOT / "eval" / "navigation_skill_tree"
DEFAULT_EXCLUDE_GLOBS = (
    "testcases/font-ocr/**",
    "holdout_preview/**",
)
ASCII_TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9_.@:-]{1,}", re.IGNORECASE)
LABEL_TOKEN_RE = re.compile(r"(?:\b(?:table|tbl|figure|fig|graph|chart)\s*[\.:#-]?\s*\d{1,4})(?=$|[^0-9a-z])", re.IGNORECASE)
JP_LABEL_TOKEN_RE = re.compile(r"(?:図|表)\s*[\.:#-]?\s*\d{1,4}")
ARTICLE_TOKEN_RE = re.compile(r"第\s*\d{1,3}\s*条")
JP_TOKEN_RE = re.compile(r"[一-龯ぁ-んァ-ンー]{2,}")
JP_CONTENT_TOKEN_RE = re.compile(r"[一-龯][一-龯ぁ-んァ-ンー]{1,}")
STOPWORDS = {
    "document",
    "summary",
    "page",
    "text",
    "table",
    "figure",
    "the",
    "and",
    "for",
    "with",
    "です",
    "ます",
    "する",
    "され",
    "この",
    "その",
    "では",
    "には",
    "とは",
    "ますか",
    "ですか",
    "して",
    "する",
    "され",
    "れて",
    "います",
    "ください",
    "何を",
    "何の",
    "何で",
    "何秒",
    "どの",
    "どこ",
    "ため",
    "とし",
    "として",
    "ください",
    "教えて",
    "説明",
    "値",
    "必要",
    "論文",
    "見たとき",
    "でしたっけ",
    "だっけ",
    "いくつ",
    "って",
}
JP_SPLIT_RE = re.compile(
    r"(?:について|における|として|でしたっけ|だっけ|してください|ください|"
    r"ですか|ますか|って|とは|では|には|から|まで|より|"
    r"[、。・（）()\\[\\]「」『』]|"
    r"何|どの|どこ|いくつ|教えて|説明|内容|値|種類|必要|"
    r"は|が|を|に|で|と|の|や|も|か)"
)


def normalize_text(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value or ""))
    return re.sub(r"\s+", " ", text).strip().lower()


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value or "").strip().lower()
    normalized = re.sub(r"[^a-z0-9一-龯ぁ-んァ-ンー]+", "-", normalized)
    normalized = re.sub(r"-+", "-", normalized).strip("-")
    return normalized or "misc"


def tokens(value: str) -> list[str]:
    normalized = normalize_text(value)
    label_tokens = [*LABEL_TOKEN_RE.findall(normalized), *JP_LABEL_TOKEN_RE.findall(normalized)]
    compact_label_tokens = [re.sub(r"\s+", "", token) for token in label_tokens]
    found = [
        *label_tokens,
        *compact_label_tokens,
        *ARTICLE_TOKEN_RE.findall(normalized),
        *ASCII_TOKEN_RE.findall(normalized),
    ]
    for ascii_token in ASCII_TOKEN_RE.findall(normalized):
        if ascii_token.endswith("site") and len(ascii_token) > 6:
            found.append(ascii_token[:-4])
        if ascii_token.endswith("harbor") and len(ascii_token) > 8:
            found.append(ascii_token[:-6])
    for token in JP_TOKEN_RE.findall(normalized):
        found.extend(part for part in JP_SPLIT_RE.split(token) if len(part) >= 2)
        found.extend(JP_CONTENT_TOKEN_RE.findall(token))
    deduped: list[str] = []
    seen: set[str] = set()
    for token in found:
        token = re.sub(r"\s+", " ", token.strip().lower())
        if re.fullmatch(r"\d+(?:[._:-]\d+)*", token):
            continue
        if len(token) < 2 or token in STOPWORDS or token in seen:
            continue
        seen.add(token)
        deduped.append(token)
    return deduped


def strong_identifier(term: str) -> bool:
    if LABEL_TOKEN_RE.fullmatch(term) or JP_LABEL_TOKEN_RE.fullmatch(term) or ARTICLE_TOKEN_RE.fullmatch(term):
        return True
    return bool(re.search(r"[a-z][0-9]|[0-9][a-z]|[_/@:-]", term, re.IGNORECASE))


def term_weight(term: str, document_frequencies: dict[str, int] | None = None, document_count: int = 0) -> int:
    if strong_identifier(term):
        return 12
    if re.search(r"[a-z]", term, re.IGNORECASE):
        base = 7
    elif re.search(r"[一-龯]", term):
        base = 6
    else:
        base = 2
    if document_frequencies and document_count:
        frequency = document_frequencies.get(term, 0)
        if frequency <= 1:
            base += 5
        elif frequency <= max(2, document_count // 5):
            base += 2
        elif frequency >= max(4, document_count // 2):
            base = max(1, base - 4)
    return base


def document_token_set(doc: dict[str, Any]) -> set[str]:
    values = [
        doc.get("source_name"),
        doc.get("source_path"),
        doc.get("summary"),
        " ".join(doc.get("keywords") or []),
    ]
    for page in doc.get("pages") or []:
        values.append(page.get("text"))
        values.append(" ".join(page.get("keywords") or []))
    return set(tokens("\n".join(str(value or "") for value in values)))


def document_frequencies(documents: list[dict[str, Any]]) -> dict[str, int]:
    frequencies: Counter[str] = Counter()
    for doc in documents:
        frequencies.update(document_token_set(doc))
    return dict(frequencies)


def is_excluded(relative_doc_json: str, exclude_globs: tuple[str, ...]) -> bool:
    relative_dir = str(Path(relative_doc_json).parent).replace("\\", "/")
    return any(fnmatch.fnmatch(relative_dir + "/", pattern.rstrip("/") + "/") or fnmatch.fnmatch(relative_dir, pattern) for pattern in exclude_globs)


def block_text(block: dict[str, Any]) -> str:
    fields = [
        block.get("reference_label"),
        block.get("caption_text"),
        block.get("context_text"),
        block.get("structured_text"),
        block.get("text"),
        block.get("summary"),
        block.get("ocr_text"),
    ]
    return "\n".join(str(field) for field in fields if field)


def load_documents(processed_root: Path, exclude_globs: tuple[str, ...]) -> list[dict[str, Any]]:
    documents: list[dict[str, Any]] = []
    for document_json in sorted(processed_root.glob("**/document.json")):
        relative_json = document_json.relative_to(processed_root).as_posix()
        if is_excluded(relative_json, exclude_globs):
            continue
        try:
            payload = json.loads(document_json.read_text(encoding="utf-8"))
        except Exception:
            continue
        source = payload.get("source") or {}
        source_path = str(source.get("relative_path") or document_json.parent.relative_to(processed_root).as_posix())
        source_name = str(source.get("name") or Path(source_path).name or document_json.parent.name)
        doc_id = hashlib.sha1(source_path.encode("utf-8")).hexdigest()[:12]
        page_texts: dict[int, list[str]] = defaultdict(list)
        document_texts: list[str] = []
        for block in payload.get("blocks") or []:
            if not isinstance(block, dict):
                continue
            try:
                page = int(block.get("page") or 0)
            except Exception:
                page = 0
            text = block_text(block)
            if text:
                document_texts.append(text)
                page_texts[page if page > 0 else 1].append(text)
        page_entries = [
            {
                "page": page,
                "text": "\n".join(parts)[:6000],
                "keywords": [term for term, _count in Counter(tokens("\n".join(parts))).most_common(12)],
            }
            for page, parts in sorted(page_texts.items())
        ]
        summary = str(payload.get("summary") or "")[:1200]
        full_keyword_source = "\n".join([source_name, source_path, summary, *[text[:2400] for text in document_texts]])
        documents.append(
            {
                "doc_id": doc_id,
                "source_name": source_name,
                "source_path": source_path,
                "processed_path": document_json.parent.relative_to(processed_root).as_posix(),
                "group": source_path.split("/", 1)[0] if "/" in source_path else "root",
                "summary": summary,
                "keywords": [term for term, _count in Counter(tokens(full_keyword_source)).most_common(20)],
                "pages": page_entries,
            }
        )
    return documents


def render_root_index(groups: dict[str, list[dict[str, Any]]]) -> str:
    lines = [
        "---",
        "name: local-rag-navigation",
        "description: Navigable summary tree compiled from processed local RAG documents.",
        "level: root",
        f"num_groups: {len(groups)}",
        "---",
        "",
        "# Local RAG Navigation",
        "",
        "Use this tree to narrow a query to likely document groups before ordinary retrieval.",
        "",
        "## Groups",
    ]
    for group, docs in sorted(groups.items()):
        keyword_counter: Counter[str] = Counter()
        for doc in docs:
            keyword_counter.update(doc.get("keywords") or [])
        keywords = ", ".join(term for term, _count in keyword_counter.most_common(10))
        lines.append(f"- [{group}](groups/{slugify(group)}/INDEX.md): {len(docs)} docs; {keywords}")
    lines.append("")
    return "\n".join(lines)


def render_group_index(group: str, docs: list[dict[str, Any]]) -> str:
    lines = [
        "---",
        f"name: {group}",
        f"description: {group} processed documents.",
        "level: group",
        f"num_documents: {len(docs)}",
        "---",
        "",
        f"# {group}",
        "",
        "## Documents",
    ]
    for doc in sorted(docs, key=lambda item: item["source_path"]):
        keywords = ", ".join(doc.get("keywords")[:10])
        summary = normalize_text(doc.get("summary"))[:220]
        lines.append(f"- [`{doc['doc_id']}` documents/{doc['doc_id']}.md]({quote_path('documents/' + doc['doc_id'] + '.md')}): {doc['source_name']} (`{doc['source_path']}`)")
        if summary:
            lines.append(f"  - summary: {summary}")
        if keywords:
            lines.append(f"  - keywords: {keywords}")
        page_refs = ", ".join(f"p.{page['page']}" for page in doc.get("pages", [])[:12])
        if page_refs:
            lines.append(f"  - pages: {page_refs}")
    lines.append("")
    return "\n".join(lines)


def quote_path(value: str) -> str:
    return value.replace(" ", "%20")


def render_document_index(doc: dict[str, Any]) -> str:
    lines = [
        "---",
        f"name: {doc['source_name']}",
        f"doc_id: {doc['doc_id']}",
        f"source_path: {doc['source_path']}",
        f"processed_path: {doc['processed_path']}",
        "level: document",
        f"num_pages: {len(doc.get('pages') or [])}",
        "---",
        "",
        f"# {doc['source_name']}",
        "",
        f"- doc_id: `{doc['doc_id']}`",
        f"- source_path: `{doc['source_path']}`",
        f"- processed_path: `{doc['processed_path']}`",
    ]
    summary = normalize_text(doc.get("summary"))
    if summary:
        lines.extend(["", "## Summary", "", summary[:900]])
    keywords = ", ".join(doc.get("keywords")[:20])
    if keywords:
        lines.extend(["", "## Keywords", "", keywords])
    lines.extend(["", "## Pages"])
    for page in doc.get("pages") or []:
        page_keywords = ", ".join(page.get("keywords", [])[:10])
        snippet = normalize_text(page.get("text"))[:320]
        lines.append(f"- p.{page['page']}")
        if page_keywords:
            lines.append(f"  - keywords: {page_keywords}")
        if snippet:
            lines.append(f"  - snippet: {snippet}")
    lines.append("")
    return "\n".join(lines)


def build_tree(args: argparse.Namespace) -> None:
    processed_root = Path(args.processed_root).resolve()
    output_root = Path(args.output_root).resolve()
    exclude_globs = tuple(args.exclude_glob or DEFAULT_EXCLUDE_GLOBS)
    documents = load_documents(processed_root, exclude_globs)
    if output_root.exists():
        shutil.rmtree(output_root)
    (output_root / "groups").mkdir(parents=True, exist_ok=True)
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for doc in documents:
        groups[doc["group"]].append(doc)
    (output_root / "SKILL.md").write_text(render_root_index(groups), encoding="utf-8")
    for group, docs in sorted(groups.items()):
        group_dir = output_root / "groups" / slugify(group)
        doc_dir = group_dir / "documents"
        group_dir.mkdir(parents=True, exist_ok=True)
        doc_dir.mkdir(parents=True, exist_ok=True)
        (group_dir / "INDEX.md").write_text(render_group_index(group, docs), encoding="utf-8")
        for doc in docs:
            doc["navigation_path"] = [
                "SKILL.md",
                f"groups/{slugify(group)}/INDEX.md",
                f"groups/{slugify(group)}/documents/{doc['doc_id']}.md",
            ]
            (doc_dir / f"{doc['doc_id']}.md").write_text(render_document_index(doc), encoding="utf-8")
    (output_root / "documents.json").write_text(
        json.dumps({"documents": documents}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps({"output_root": str(output_root), "documents": len(documents), "groups": len(groups)}, ensure_ascii=False))


def score_document(
    query_terms: list[str],
    doc: dict[str, Any],
    document_frequencies: dict[str, int] | None = None,
    document_count: int = 0,
) -> tuple[int, list[dict[str, Any]]]:
    haystacks = {
        "name": normalize_text(doc.get("source_name")),
        "path": normalize_text(doc.get("source_path")),
        "summary": normalize_text(doc.get("summary")),
        "keywords": normalize_text(" ".join(doc.get("keywords") or [])),
    }
    score = 0
    for term in query_terms:
        weight = term_weight(term, document_frequencies, document_count)
        if term in haystacks["name"] or term in haystacks["path"]:
            score += weight * (5 if strong_identifier(term) else 3)
        elif term in haystacks["summary"]:
            score += weight * 2
        elif term in haystacks["keywords"]:
            score += weight
    page_scores: list[dict[str, Any]] = []
    for page in doc.get("pages") or []:
        page_blob = normalize_text("\n".join([page.get("text") or "", " ".join(page.get("keywords") or [])]))
        page_score = sum(term_weight(term, document_frequencies, document_count) for term in query_terms if term in page_blob)
        if page_score:
            page_scores.append({"page": page["page"], "score": page_score, "keywords": page.get("keywords", [])[:8]})
    page_scores.sort(key=lambda item: item["score"], reverse=True)
    if page_scores:
        score += page_scores[0]["score"]
    elif score > 0 and len(doc.get("pages") or []) == 1:
        page = doc["pages"][0]
        page_scores.append({"page": page["page"], "score": 1, "keywords": page.get("keywords", [])[:8]})
    return score, page_scores


def query_tree(args: argparse.Namespace) -> None:
    tree_path = Path(args.tree_root).resolve() / "documents.json"
    payload = json.loads(tree_path.read_text(encoding="utf-8"))
    query_terms = tokens(args.query)
    documents = payload.get("documents") or []
    frequencies = document_frequencies(documents)
    candidates = []
    for doc in documents:
        score, page_scores = score_document(query_terms, doc, frequencies, len(documents))
        if score <= 0:
            continue
        candidates.append(
            {
                "doc_id": doc["doc_id"],
                "source_name": doc["source_name"],
                "source_path": doc["source_path"],
                "score": score,
                "pages": page_scores[: args.pages],
                "keywords": doc.get("keywords", [])[:10],
                "navigation_path": doc.get("navigation_path") or [],
            }
        )
    candidates.sort(key=lambda item: item["score"], reverse=True)
    print(json.dumps({"query": args.query, "terms": query_terms, "candidates": candidates[: args.limit]}, ensure_ascii=False, indent=2))


def same_document(actual: Any, expected: Any) -> bool:
    actual_norm = normalize_text(actual)
    expected_norm = normalize_text(expected)
    if not actual_norm or not expected_norm:
        return False
    return actual_norm == expected_norm or actual_norm.endswith("/" + expected_norm) or actual_norm.endswith("\\" + expected_norm)


def eval_tree(args: argparse.Namespace) -> None:
    cases = json.loads(Path(args.cases).read_text(encoding="utf-8"))
    tree_path = Path(args.tree_root).resolve() / "documents.json"
    payload = json.loads(tree_path.read_text(encoding="utf-8"))
    documents = payload.get("documents") or []
    frequencies = document_frequencies(documents)
    results = []
    for case in cases:
        query_terms = tokens(case["query"])
        candidates = []
        for doc in documents:
            score, page_scores = score_document(query_terms, doc, frequencies, len(documents))
            if score <= 0:
                continue
            candidates.append({"doc": doc, "score": score, "pages": page_scores})
        candidates.sort(key=lambda item: item["score"], reverse=True)
        top = candidates[0] if candidates else {"doc": {}, "score": 0, "pages": []}
        expected_doc = case.get("expected_doc")
        expected_page = case.get("expected_page")
        page_any = False
        page_top1 = False
        if expected_page not in (None, ""):
            try:
                expected_page_int = int(expected_page)
            except Exception:
                expected_page_int = None
            page_any = any(
                same_document(item["doc"].get("source_path"), expected_doc)
                and any(page.get("page") == expected_page_int for page in item.get("pages") or [])
                for item in candidates[: args.limit]
            )
            page_top1 = same_document(top["doc"].get("source_path"), expected_doc) and any(
                page.get("page") == expected_page_int for page in top.get("pages") or []
            )
        else:
            page_any = True
            page_top1 = True
        results.append(
            {
                "id": case["id"],
                "query": case["query"],
                "expected_doc": expected_doc,
                "expected_page": expected_page,
                "doc_top1_hit": same_document(top["doc"].get("source_path"), expected_doc),
                "doc_any_hit": any(same_document(item["doc"].get("source_path"), expected_doc) for item in candidates[: args.limit]),
                "page_top1_hit": page_top1,
                "page_any_hit": page_any,
                "top_candidate": {
                    "source_path": top["doc"].get("source_path"),
                    "score": top.get("score"),
                    "pages": top.get("pages", [])[: args.pages],
                    "navigation_path": top["doc"].get("navigation_path") or [],
                },
            }
        )

    total = len(results)
    summary = {
        "case_count": total,
        "doc_top1_hit_rate": round(sum(1 for item in results if item["doc_top1_hit"]) / total * 100, 1) if total else 0.0,
        "doc_any_hit_rate": round(sum(1 for item in results if item["doc_any_hit"]) / total * 100, 1) if total else 0.0,
        "page_top1_hit_rate": round(sum(1 for item in results if item["page_top1_hit"]) / total * 100, 1) if total else 0.0,
        "page_any_hit_rate": round(sum(1 for item in results if item["page_any_hit"]) / total * 100, 1) if total else 0.0,
    }
    output = {"summary": summary, "results": results}
    if args.output:
        Path(args.output).write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(output, ensure_ascii=False, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description="Build and query a lightweight Corpus2Skill-style navigation tree.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    build_parser = subparsers.add_parser("build")
    build_parser.add_argument("--processed-root", default=str(DEFAULT_PROCESSED_ROOT))
    build_parser.add_argument("--output-root", default=str(DEFAULT_OUTPUT_ROOT))
    build_parser.add_argument("--exclude-glob", action="append")
    build_parser.set_defaults(func=build_tree)

    query_parser = subparsers.add_parser("query")
    query_parser.add_argument("query")
    query_parser.add_argument("--tree-root", default=str(DEFAULT_OUTPUT_ROOT))
    query_parser.add_argument("--limit", type=int, default=5)
    query_parser.add_argument("--pages", type=int, default=3)
    query_parser.set_defaults(func=query_tree)

    eval_parser = subparsers.add_parser("eval")
    eval_parser.add_argument("--cases", default=str(ROOT / "eval" / "eval_cases.json"))
    eval_parser.add_argument("--tree-root", default=str(DEFAULT_OUTPUT_ROOT))
    eval_parser.add_argument("--limit", type=int, default=5)
    eval_parser.add_argument("--pages", type=int, default=3)
    eval_parser.add_argument("--output", default="")
    eval_parser.set_defaults(func=eval_tree)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
