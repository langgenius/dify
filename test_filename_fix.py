#!/usr/bin/env python3
"""Test the filename extraction fix."""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from urllib.parse import urlparse


# Mock extract_filename logic based on the actual implementation
def mock_extract_filename(url_path: str, content_disposition: str | None) -> str | None:
    """Mock implementation of extract_filename for testing."""
    import urllib.parse
    import os
    import re

    filename: str | None = None
    if content_disposition:
        # Simplified version - just get filename from Content-Disposition
        filename_match = re.search(r'filename\s*=\s*["\']?([^"\'\s;]+)["\']?', content_disposition)
        if filename_match:
            filename = filename_match.group(1)
            filename = urllib.parse.unquote(filename, errors="replace")

    if not filename:
        candidate = os.path.basename(url_path)
        filename = urllib.parse.unquote(candidate) if candidate else None

    if filename:
        filename = os.path.basename(filename)
        if not filename or not filename.strip():
            filename = None

    return filename or None


def test_urls():
    """Test various URL patterns."""
    test_cases = [
        # (url, expected_filename)
        ("https://example.com/file.pdf", "file.pdf"),
        ("https://example.com/file%20name.pdf", "file name.pdf"),
        ("https://example.com/file.pdf?query=param", "file.pdf"),
        ("https://example.com/file.pdf#section", "file.pdf"),
        ("https://example.com/file.pdf?AWSAccessKeyId=AKIAEXAMPLE", "file.pdf"),
        ("https://example.com/path%2Fto%2Ffile.pdf", "file.pdf"),
        ("https://example.com/file%20name.pdf?query=param#section", "file name.pdf"),
        ("https://example.com/", None),  # No filename in path
        ("https://example.com/file.txt?version=1&token=abc123", "file.txt"),
    ]

    print("Testing URL filename extraction:")
    print("=" * 60)

    for url, expected in test_cases:
        parsed = urlparse(url)
        url_path = parsed.path
        result = mock_extract_filename(url_path, None)

        status = "✓" if result == expected else "✗"
        print(f"{status} URL: {url}")
        print(f"  Path: {url_path}")
        print(f"  Expected: {expected}")
        print(f"  Got: {result}")
        print()


def test_content_disposition():
    """Test Content-Disposition header parsing."""
    test_cases = [
        # (content_disposition, expected_filename)
        ('attachment; filename="file.pdf"', "file.pdf"),
        ("attachment; filename=file.pdf", "file.pdf"),
        ('attachment; filename="file%20name.pdf"', "file name.pdf"),
        ("attachment; filename=file%20name.pdf", "file name.pdf"),
    ]

    print("\nTesting Content-Disposition parsing:")
    print("=" * 60)

    for content_disp, expected in test_cases:
        result = mock_extract_filename("", content_disp)

        status = "✓" if result == expected else "✗"
        print(f"{status} Content-Disposition: {content_disp}")
        print(f"  Expected: {expected}")
        print(f"  Got: {result}")
        print()


if __name__ == "__main__":
    test_urls()
    test_content_disposition()
    print("\nDone!")
