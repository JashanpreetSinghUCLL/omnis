"""Markdown-aware text chunker.

- 500-token chunks, 100-token overlap (SentenceSplitter).
- Code blocks (``` ... ```) are treated as atomic units — never split
  mid-block, even if that makes a single chunk larger than chunk_size.

Strategy
--------
1. Extract every fenced code block and replace it with a single-token
   placeholder.  The placeholder is always < chunk_size tokens, so
   SentenceSplitter keeps it in one piece.
2. Run SentenceSplitter on the sanitised text.
3. Re-expand placeholders in each resulting chunk.

If a code block's *placeholder* ends up spanning a chunk boundary due to
the overlap window, both neighbouring chunks get the full code block — this
is intentional and mirrors what 100-token overlap does for prose.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from llama_index.core.node_parser import SentenceSplitter  # type: ignore[import-untyped]

_CODE_BLOCK_RE = re.compile(r"```[\s\S]*?```", re.MULTILINE)
_PAGE_HINT_RE = re.compile(r"<!-- Page (\d+) -->")
_PLACEHOLDER_TPL = "CODEBLK{idx:04d}PLACEHOLDER"

# Rough chars-per-token used only for the informational token_count field.
_CHARS_PER_TOKEN = 4.0


@dataclass
class Chunk:
    text: str
    chunk_index: int
    page_hint: int | None  # first <!-- Page N --> marker found in chunk
    token_count: int        # approximate, for logging only
    source_hash: str = field(default="")  # populated by pipeline


def _extract_code_blocks(text: str) -> tuple[str, dict[str, str]]:
    """Replace fenced code blocks with stable single-word placeholders.

    Returns the sanitised text and a mapping {placeholder → original block}.
    """
    blocks: dict[str, str] = {}
    counter = 0

    def replacer(m: re.Match[str]) -> str:
        nonlocal counter
        key = _PLACEHOLDER_TPL.format(idx=counter)
        blocks[key] = m.group(0)
        counter += 1
        return key

    sanitised = _CODE_BLOCK_RE.sub(replacer, text)
    return sanitised, blocks


def _restore_code_blocks(text: str, blocks: dict[str, str]) -> str:
    for key, original in blocks.items():
        text = text.replace(key, original)
    return text


def chunk_document(
    content: str,
    chunk_size: int = 500,
    chunk_overlap: int = 100,
    source_hash: str = "",
) -> list[Chunk]:
    """Split *content* into overlapping chunks, preserving code blocks.

    Parameters
    ----------
    content:       Full markdown text of the document.
    chunk_size:    Target chunk size in tokens.
    chunk_overlap: Overlap between consecutive chunks in tokens.
    source_hash:   SHA-256 of the source PDF (carried through for caching).
    """
    sanitised, code_blocks = _extract_code_blocks(content)

    splitter = SentenceSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
    )
    raw_chunks = splitter.split_text(sanitised)

    chunks: list[Chunk] = []
    for idx, raw in enumerate(raw_chunks):
        restored = _restore_code_blocks(raw, code_blocks)

        page_match = _PAGE_HINT_RE.search(restored)
        page_hint = int(page_match.group(1)) if page_match else None
        token_count = max(1, int(len(restored) / _CHARS_PER_TOKEN))

        chunks.append(
            Chunk(
                text=restored,
                chunk_index=idx,
                page_hint=page_hint,
                token_count=token_count,
                source_hash=source_hash,
            )
        )

    return chunks
