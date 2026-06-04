from __future__ import annotations

import re

from bs4 import BeautifulSoup


def clean_html(raw: str) -> str:
    if not raw or not raw.strip():
        return ""

    soup = BeautifulSoup(raw, "html.parser")

    for tag in soup.find_all(["script", "style"]):
        tag.decompose()

    for tag in soup.find_all(["br", "p", "div", "li", "tr"]):
        tag.insert_before("\n")
        if tag.name in ("p", "div", "tr"):
            tag.insert_after("\n")

    text = soup.get_text(separator="")

    text = re.sub(r" +", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = "\n".join(line.strip() for line in text.splitlines())
    text = re.sub(r"\n{3,}", "\n\n", text)

    return text.strip()
