"""Unit tests for ingestion/parser.py.

All external I/O (LlamaParse, PyMuPDF) is mocked.  Tests focus on:
- Hash computation
- Output validation (too-short, garbled)
- Fallback path when LlamaParse is unavailable
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ingestion.parser import ParsedDocument, _sha256_file, _validate, parse_pdf


# ── Fixtures


@pytest.fixture
def tmp_pdf(tmp_path: Path) -> Path:
    """Minimal fake PDF (just a file with bytes — PyMuPDF is mocked)."""
    p = tmp_path / "test.pdf"
    p.write_bytes(b"%PDF-1.4 fake content for hashing")
    return p


# ── Hash


def test_sha256_file_is_deterministic(tmp_pdf: Path) -> None:
    h1 = _sha256_file(tmp_pdf)
    h2 = _sha256_file(tmp_pdf)
    assert h1 == h2
    assert len(h1) == 64


def test_sha256_changes_with_content(tmp_path: Path) -> None:
    f1 = tmp_path / "a.pdf"
    f2 = tmp_path / "b.pdf"
    f1.write_bytes(b"aaa")
    f2.write_bytes(b"bbb")
    assert _sha256_file(f1) != _sha256_file(f2)


# ── Validation


def test_validate_rejects_empty(tmp_pdf: Path) -> None:
    with pytest.raises(ValueError, match="too little content"):
        _validate("   ", tmp_pdf)


def test_validate_rejects_garbled(tmp_pdf: Path) -> None:
    garbled = "???" * 500
    with pytest.raises(ValueError, match="garbled"):
        _validate(garbled, tmp_pdf)


def test_validate_accepts_normal(tmp_pdf: Path) -> None:
    _validate("This is a normal document with plenty of text content.", tmp_pdf)


# ── PyMuPDF path


@pytest.mark.asyncio
async def test_parse_pdf_uses_pymupdf_when_no_key(tmp_pdf: Path) -> None:
    # fitz and LlamaParse are lazy-imported inside functions, so patch the
    # internal helpers rather than module-level names.
    fake_content = "Page content here with enough text to pass validation."

    with patch(
        "ingestion.parser._parse_pymupdf", return_value=(fake_content, 1)
    ) as mock_pymupdf:
        result = await parse_pdf(tmp_pdf, llama_cloud_api_key=None)
        mock_pymupdf.assert_called_once_with(tmp_pdf)

    assert result.parser_used == "pymupdf"
    assert result.page_count == 1
    assert result.content_hash == _sha256_file(tmp_pdf)
    assert "Page content" in result.content


@pytest.mark.asyncio
async def test_parse_pdf_raises_for_missing_file() -> None:
    with pytest.raises(FileNotFoundError):
        await parse_pdf(Path("/nonexistent/file.pdf"))


# ── LlamaParse path


@pytest.mark.asyncio
async def test_parse_pdf_uses_llamaparse_when_key_provided(tmp_pdf: Path) -> None:
    fake_content = "# Document\n\nThis is enough content to pass the validation check."

    with patch(
        "ingestion.parser._parse_llamaparse",
        new=AsyncMock(return_value=(fake_content, 3)),
    ):
        result = await parse_pdf(tmp_pdf, llama_cloud_api_key="test-key")

    assert result.parser_used == "llamaparse"
    assert result.page_count == 3


@pytest.mark.asyncio
async def test_parse_pdf_falls_back_to_pymupdf_on_llamaparse_error(
    tmp_pdf: Path,
) -> None:
    """If LlamaParse raises, fall through to PyMuPDF."""
    fake_content = "Fallback content with sufficient length for validation."

    with (
        patch(
            "ingestion.parser._parse_llamaparse",
            new=AsyncMock(side_effect=RuntimeError("API down")),
        ),
        patch("ingestion.parser._parse_pymupdf", return_value=(fake_content, 1)),
    ):
        result = await parse_pdf(tmp_pdf, llama_cloud_api_key="test-key")

    assert result.parser_used == "pymupdf"
