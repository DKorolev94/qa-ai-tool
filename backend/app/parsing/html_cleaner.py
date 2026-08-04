from __future__ import annotations

import re

from bs4 import BeautifulSoup


def clean_html(raw: str) -> str:
    if not raw or not raw.strip():
        return ""

    soup = BeautifulSoup(raw, "html.parser")

    # Strikethrough marks content the author voided (e.g. "no longer a bug,
    # kept as history") — keeping that text would hand the LLM a step whose
    # action reads like a live instruction while actually meaning the opposite.
    for tag in soup.find_all(["script", "style", "s", "del", "strike"]):
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
