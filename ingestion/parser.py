"""PDF → Markdown parser.

Primary:  LlamaParse (cloud, requires LLAMA_CLOUD_API_KEY).
Fallback: PyMuPDF  (local, no API key).

The ParsedDocument includes a SHA-256 content hash that drives
idempotency checks downstream.
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

_GARBLED_RATIO = 0.10  # fraction of '???' chars that signals a bad parse


@dataclass
class ParsedDocument:
    content: str
    source_path: Path
    content_hash: str  # SHA-256 of raw PDF bytes
    page_count: int
    parser_used: str  # "llamaparse" | "pymupdf"


# ── Internal helpers ─────────────────────────────────────────────────────────


def _sha256_file(path: Path) -> str:
    sha = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(65_536), b""):
            sha.update(block)
    return sha.hexdigest()


def _validate(content: str, path: Path) -> None:
    stripped = content.strip()
    if len(stripped) < 50:
        raise ValueError(f"Parser returned too little content for {path.name!r}")
    if content.count("???") > len(content) * _GARBLED_RATIO:
        raise ValueError(f"Parser output looks garbled for {path.name!r}")


# ── LlamaParse ───────────────────────────────────────────────────────────────


async def _parse_llamaparse(path: Path, api_key: str) -> tuple[str, int]:
    from llama_parse import LlamaParse  # type: ignore[import-untyped]

    parser = LlamaParse(
        api_key=api_key,
        result_type="markdown",
        verbose=False,
    )
    documents = await parser.aload_data(str(path))
    if not documents:
        raise ValueError(f"LlamaParse returned no documents for {path.name!r}")

    # page_count: use metadata if present, else number of returned docs
    page_count = sum(d.metadata.get("total_pages", 1) for d in documents) or len(documents)
    content = "\n\n---\n\n".join(d.text for d in documents)

    logger.info("LlamaParse parsed %d page(s) from %r", page_count, path.name)
    return content, page_count


# ── PyMuPDF fallback ─────────────────────────────────────────────────────────


def _parse_pymupdf(path: Path) -> tuple[str, int]:
    import fitz  # type: ignore[import-untyped]  # PyMuPDF

    doc = fitz.open(str(path))
    page_count = len(doc)
    pages: list[str] = []
    for i, page in enumerate(doc):
        text = page.get_text("text")
        if text.strip():
            pages.append(f"<!-- Page {i + 1} -->\n{text}")
    doc.close()

    content = "\n\n".join(pages)
    logger.info("PyMuPDF parsed %d page(s) from %r", page_count, path.name)
    return content, page_count


# ── Public API ───────────────────────────────────────────────────────────────


async def parse_pdf(
    path: str | Path,
    llama_cloud_api_key: str | None = None,
) -> ParsedDocument:
    """Parse a PDF to Markdown.

    Uses LlamaParse when *llama_cloud_api_key* is provided; falls back to
    PyMuPDF otherwise.  Raises ValueError if the parsed output looks invalid.
    """
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"PDF not found: {path}")

    content_hash = _sha256_file(path)

    if llama_cloud_api_key:
        try:
            content, page_count = await _parse_llamaparse(path, llama_cloud_api_key)
            parser_used = "llamaparse"
        except Exception as exc:
            logger.warning("LlamaParse failed (%s); falling back to PyMuPDF", exc)
            content, page_count = _parse_pymupdf(path)
            parser_used = "pymupdf"
    else:
        content, page_count = _parse_pymupdf(path)
        parser_used = "pymupdf"

    _validate(content, path)

    return ParsedDocument(
        content=content,
        source_path=path,
        content_hash=content_hash,
        page_count=page_count,
        parser_used=parser_used,
    )
