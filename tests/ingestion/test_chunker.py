"""Unit tests for ingestion/chunker.py.

Focus on:
- Code block preservation (never split mid-block)
- chunk_index monotonically increasing
- page_hint extraction
- source_hash propagation
"""

from __future__ import annotations

import pytest

from ingestion.chunker import Chunk, chunk_document


def _make_prose(n_words: int) -> str:
    word = "word"
    return " ".join([word] * n_words)


# ── Basic splitting


def test_returns_at_least_one_chunk() -> None:
    chunks = chunk_document("Hello world, this is some text.", chunk_size=500)
    assert len(chunks) >= 1


def test_chunk_indices_are_sequential() -> None:
    content = _make_prose(1000)
    chunks = chunk_document(content, chunk_size=100, chunk_overlap=20)
    indices = [c.chunk_index for c in chunks]
    assert indices == list(range(len(chunks)))


def test_source_hash_propagated() -> None:
    chunks = chunk_document("Some content here.", source_hash="abc123")
    assert all(c.source_hash == "abc123" for c in chunks)


# ── Code block preservation


def test_code_block_not_split() -> None:
    """A fenced code block must appear intact in at least one chunk."""
    code_block = "```python\ndef foo():\n    return 42\n```"
    # Surround the code block with prose so it sits in the middle of a long doc
    content = _make_prose(300) + "\n\n" + code_block + "\n\n" + _make_prose(300)

    chunks = chunk_document(content, chunk_size=100, chunk_overlap=10)

    # At least one chunk must contain the entire code block verbatim
    found = any(code_block in c.text for c in chunks)
    assert found, "Code block was split across chunks"


def test_multiple_code_blocks_preserved() -> None:
    blocks = [
        "```bash\necho hello\n```",
        "```python\nprint('world')\n```",
    ]
    content = (
        _make_prose(200)
        + "\n\n"
        + blocks[0]
        + "\n\n"
        + _make_prose(200)
        + "\n\n"
        + blocks[1]
        + "\n\n"
        + _make_prose(200)
    )
    chunks = chunk_document(content, chunk_size=100, chunk_overlap=10)

    for block in blocks:
        assert any(block in c.text for c in chunks), f"Block not found intact: {block}"


def test_no_placeholder_leaks_into_output() -> None:
    """CODEBLK…PLACEHOLDER tokens must never appear in final chunks."""
    code_block = "```sql\nSELECT 1;\n```"
    content = _make_prose(100) + "\n\n" + code_block + "\n\n" + _make_prose(100)
    chunks = chunk_document(content, chunk_size=50, chunk_overlap=10)

    for chunk in chunks:
        assert "PLACEHOLDER" not in chunk.text
        assert "CODEBLK" not in chunk.text


# ── Page hint extraction


def test_page_hint_extracted() -> None:
    content = "<!-- Page 3 -->\nSome content on page 3."
    chunks = chunk_document(content, chunk_size=500)
    assert chunks[0].page_hint == 3


def test_page_hint_none_when_absent() -> None:
    chunks = chunk_document("No page marker here.", chunk_size=500)
    assert chunks[0].page_hint is None


# ── Token count


def test_token_count_positive() -> None:
    chunks = chunk_document(_make_prose(100), chunk_size=500)
    assert all(c.token_count > 0 for c in chunks)
