from __future__ import annotations

import re

from app.schemas.testcase import Attachment

_URL_PATTERN = re.compile(
    r'https?://[^\s<>"\']+',
    re.IGNORECASE,
)

_EXT_TYPE_MAP = {
    ".png": "image",
    ".jpg": "image",
    ".jpeg": "image",
    ".gif": "image",
    ".pdf": "document",
    ".docx": "document",
    ".xlsx": "spreadsheet",
    ".xls": "spreadsheet",
    ".csv": "spreadsheet",
    ".txt": "text",
}

_SUPPORTED_EXTS = tuple(_EXT_TYPE_MAP.keys())


def _classify(url: str) -> str | None:
    lower = url.lower().split("?")[0]
    for ext, kind in _EXT_TYPE_MAP.items():
        if lower.endswith(ext):
            return kind
    return None


def _extract_name(url: str) -> str | None:
    path = url.split("?")[0].rstrip("/")
    name = path.split("/")[-1] if "/" in path else None
    return name or None


def extract_attachments(raw: str) -> list[Attachment]:
    if not raw:
        return []

    attachments: list[Attachment] = []
    seen: set[str] = set()

    for url in _URL_PATTERN.findall(raw):
        url = url.rstrip(".,;)")
        lower = url.lower().split("?")[0]
        if not any(lower.endswith(ext) for ext in _SUPPORTED_EXTS):
            continue
        if url in seen:
            continue
        seen.add(url)
        attachments.append(
            Attachment(
                name=_extract_name(url),
                url=url,
                type=_classify(url),
            )
        )

    return attachments
