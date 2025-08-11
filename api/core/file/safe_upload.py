import os
import re
import unicodedata
from pathlib import Path
from typing import IO


def _parse_set(env_key: str, default_csv: str) -> set[str]:
    raw = os.getenv(env_key, default_csv)
    return {s.strip().lower() for s in raw.split(",") if s.strip()}


ALLOWED_EXTS: set[str] = _parse_set(
    "PLUGIN_UPLOAD_ALLOWED_EXTS",
    ".png,.jpg,.jpeg,.gif,.pdf,.txt,.csv,.json",
)

BLOCKED_SUFFIXES: set[str] = _parse_set(
    "PLUGIN_UPLOAD_BLOCKED_SUFFIXES",
    ".php,.jsp,.exe,.sh,.bat,.js,.html,.htm",
)

EXT_TO_MIME: dict[str, str] = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".json": "application/json",
}

_RTL_CTRL = re.compile(r"[\u200e\u200f\u202a-\u202e]")


def normalize_filename(name: str) -> str:
    name = unicodedata.normalize("NFKC", name or "")
    name = _RTL_CTRL.sub("", name)
    name = name.replace("\\", "/").split("/")[-1]
    return name


def split_suffixes(name: str) -> tuple[str, list]:
    p = Path(name)
    return p.name, [s.lower() for s in p.suffixes]


def is_safe_suffixes(suffixes: list) -> bool:
    if not suffixes:
        return False
    if suffixes[-1] not in ALLOWED_EXTS:
        return False
    for s in suffixes:
        if s in BLOCKED_SUFFIXES:
            return False
    if len(suffixes) > 2:
        return False
    return True


def canonical_mimetype(ext: str) -> str:
    return EXT_TO_MIME.get(ext.lower(), "application/octet-stream")


def sniff_ok(stream: IO[bytes], ext: str) -> bool:
    try:
        pos = stream.tell()
    except Exception:
        pos = None
    head = stream.read(16)
    if pos is not None:
        try:
            stream.seek(pos)
        except Exception:
            pass

    ext = ext.lower()
    if ext == ".png":
        return head.startswith(b"\x89PNG\r\n\x1a\n")
    if ext in (".jpg", ".jpeg"):
        return head[:2] == b"\xff\xd8"
    if ext == ".gif":
        return head[:6] in (b"GIF87a", b"GIF89a")
    if ext == ".pdf":
        return head.startswith(b"%PDF-")
    if ext in (".txt", ".csv", ".json"):
        try:
            head.decode("utf-8", errors="strict")
            return True
        except Exception:
            return False
    return False
