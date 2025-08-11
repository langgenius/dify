import os
import re
import unicodedata
from pathlib import Path
from typing import IO, Optional, Tuple

import filetype
import mimetypes

# env
def _parse_set(env_key: str, default_csv: str) -> set[str]:
    raw = os.getenv(env_key, default_csv)
    return {s.strip().lower() for s in raw.split(",") if s.strip()}

# Still retain: whitelist / dangerous suffix / compound suffix restriction - this is the basis for access
ALLOWED_EXTS: set[str] = _parse_set(
    "PLUGIN_UPLOAD_ALLOWED_EXTS",
    ".png,.jpg,.jpeg,.gif,.pdf,.txt,.csv,.json",  # 你可在 env 放开更多：.zip,.docx,.mp3 等
)
BLOCKED_SUFFIXES: set[str] = _parse_set(
    "PLUGIN_UPLOAD_BLOCKED_SUFFIXES",
    ".php,.jsp,.exe,.sh,.bat,.js,.html,.htm",
)

# This group of types is strongly checked (anti-masquerade); other types are not forced to match to avoid false positives
STRICT_EXTS: set[str] = {
    ".png", ".jpg", ".jpeg", ".gif", ".pdf", ".txt", ".csv", ".json"
}

# File name normalization
_RTL_CTRL = re.compile(r"[\u200e\u200f\u202a-\u202e]")

def normalize_filename(name: str) -> str:
    name = unicodedata.normalize("NFKC", name or "")
    name = _RTL_CTRL.sub("", name)
    name = name.replace("\\", "/").split("/")[-1]
    return name

def split_suffixes(name: str) -> tuple[str, list[str]]:
    p = Path(name)
    return p.name, [s.lower() for s in p.suffixes]

def is_safe_suffixes(suffixes: list[str]) -> bool:
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

# Automatically detect mime/ext using filetype
def _detect_with_filetype(stream: IO[bytes]) -> tuple[Optional[str], Optional[str]]:
    try:
        pos = stream.tell()
    except Exception:
        pos = None
    head = stream.read(560)  # 足够覆盖 zip/iso-bmff/ID3/RIFF 等
    if pos is not None:
        try:
            stream.seek(pos)
        except Exception:
            pass
    kind = filetype.guess(head)
    if kind:
        return f".{kind.extension.lower()}", kind.mime.lower() if kind.mime else None
    return None, None

def choose_server_mime(ext: str, detected_mime: Optional[str]) -> str:
    if detected_mime:
        return detected_mime
    mime, _ = mimetypes.guess_type("x" + ext)  # ext 带点
    return (mime or "application/octet-stream").lower()

# Strong validation: only enforced for strict types
def sniff_ok(stream: IO[bytes], declared_ext: str) -> bool:
    declared_ext = declared_ext.lower()
    if declared_ext not in STRICT_EXTS:
        # No blocking for non-strict types (determined by whitelist); sniffing is only used for subsequent logging/normalization
        return True
    det_ext, det_mime = _detect_with_filetype(stream)
    # Strict type: requires detection and suffix matching (e.g. .png detects png)
    return det_ext == declared_ext