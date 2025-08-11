import os
import re
import unicodedata
from pathlib import Path
from typing import IO, Optional, Tuple

import filetype
import mimetypes

# env 解析
def _parse_set(env_key: str, default_csv: str) -> set[str]:
    raw = os.getenv(env_key, default_csv)
    return {s.strip().lower() for s in raw.split(",") if s.strip()}

# 仍保留：白名单 / 危险后缀 / 复合后缀限制 —— 这是准入基础
ALLOWED_EXTS: set[str] = _parse_set(
    "PLUGIN_UPLOAD_ALLOWED_EXTS",
    ".png,.jpg,.jpeg,.gif,.pdf,.txt,.csv,.json",  # 你可在 env 放开更多：.zip,.docx,.mp3 等
)
BLOCKED_SUFFIXES: set[str] = _parse_set(
    "PLUGIN_UPLOAD_BLOCKED_SUFFIXES",
    ".php,.jsp,.exe,.sh,.bat,.js,.html,.htm",
)

# 这组类型做强校验（防伪装）；其余类型不强制匹配以避免误杀
STRICT_EXTS: set[str] = {
    ".png", ".jpg", ".jpeg", ".gif", ".pdf", ".txt", ".csv", ".json"
}

# 文件名规范化
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

# 用 filetype 自动检测 mime/ext
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
        # kind.extension 是如 "png"/"pdf"/"zip"/"mp3"
        return f".{kind.extension.lower()}", kind.mime.lower() if kind.mime else None
    return None, None

def choose_server_mime(ext: str, detected_mime: Optional[str]) -> str:
    if detected_mime:
        return detected_mime
    mime, _ = mimetypes.guess_type("x" + ext)  # ext 带点
    return (mime or "application/octet-stream").lower()

# 强校验：仅对严格类型执行
def sniff_ok(stream: IO[bytes], declared_ext: str) -> bool:
    declared_ext = declared_ext.lower()
    if declared_ext not in STRICT_EXTS:
        # 对非严格类型不阻断（由白名单决定）；嗅探仅用于后续记录/归一化
        return True
    det_ext, det_mime = _detect_with_filetype(stream)
    # 严格类型：要求能检测到且后缀匹配（如 .png 检测到 png）
    return det_ext == declared_ext