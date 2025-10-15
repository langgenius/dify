"""
Unit tests for _sanitize_value method in BaseAppGenerator.

Tests the XSS protection and input sanitization functionality.
Addresses CVE-2025-49149: Insufficient user input filtering.
"""

import pytest

from core.app.apps.base_app_generator import BaseAppGenerator


class TestSanitizeValue:
    """Test suite for the _sanitize_value method"""

    def setup_method(self):
        """Set up test fixtures"""
        # Create a minimal instance for testing
        self.generator = BaseAppGenerator()

    def test_sanitize_xss_script_tag(self):
        """Test that script tags are properly escaped"""
        malicious_input = "<script>alert('XSS')</script>"
        result = self.generator._sanitize_value(malicious_input)

        # Should not contain actual script tags
        assert "<script>" not in result
        assert "</script>" not in result
        # Should be HTML escaped
        assert "&lt;script&gt;" in result
        assert "&lt;/script&gt;" in result

    def test_sanitize_xss_img_tag(self):
        """Test that img tags with onerror are escaped"""
        malicious_input = '<img src=x onerror="alert(1)">'
        result = self.generator._sanitize_value(malicious_input)

        assert "<img" not in result
        assert "onerror" not in result or "&" in result  # Should be escaped

    def test_sanitize_xss_onclick_event(self):
        """Test that event handlers are escaped"""
        malicious_input = '<div onclick="malicious()">Click me</div>'
        result = self.generator._sanitize_value(malicious_input)

        assert "<div" not in result
        assert "onclick" not in result or "&" in result

    def test_sanitize_null_byte(self):
        """Test that null bytes are removed"""
        input_with_null = "Hello\x00World"
        result = self.generator._sanitize_value(input_with_null)

        assert "\x00" not in result
        assert result == "HelloWorld"

    def test_sanitize_control_characters(self):
        """Test that control characters are removed (except newline and tab)"""
        # Test various control characters
        input_with_controls = "Hello\x01\x02\x03World"
        result = self.generator._sanitize_value(input_with_controls)

        assert "\x01" not in result
        assert "\x02" not in result
        assert "\x03" not in result

    def test_sanitize_preserves_newline_and_tab(self):
        """Test that legitimate formatting characters are preserved"""
        input_with_formatting = "Line1\nLine2\tTabbed"
        result = self.generator._sanitize_value(input_with_formatting)

        # Newlines and tabs should be preserved (though may be escaped for HTML)
        assert "Line1" in result
        assert "Line2" in result

    def test_sanitize_html_entities(self):
        """Test that HTML special characters are escaped"""
        input_with_entities = "< > & \" '"
        result = self.generator._sanitize_value(input_with_entities)

        # Should be escaped
        assert "&lt;" in result
        assert "&gt;" in result
        assert "&amp;" in result

    def test_sanitize_non_string_input(self):
        """Test that non-string inputs are returned unchanged"""
        # Integer
        assert self.generator._sanitize_value(123) == 123

        # Float
        assert self.generator._sanitize_value(45.67) == 45.67

        # Boolean
        assert self.generator._sanitize_value(True) is True

        # None
        assert self.generator._sanitize_value(None) is None

        # List
        test_list = [1, 2, 3]
        assert self.generator._sanitize_value(test_list) == test_list

        # Dict
        test_dict = {"key": "value"}
        assert self.generator._sanitize_value(test_dict) == test_dict

    def test_sanitize_empty_string(self):
        """Test that empty strings are handled correctly"""
        result = self.generator._sanitize_value("")
        assert result == ""

    def test_sanitize_unicode_characters(self):
        """Test that legitimate Unicode characters are preserved"""
        unicode_input = "Hello 世界 🌍"
        result = self.generator._sanitize_value(unicode_input)

        # Should preserve Unicode (though may be escaped if needed)
        assert len(result) > 0

    def test_sanitize_sql_injection_attempt(self):
        """Test that potential SQL injection strings are escaped"""
        sql_injection = "'; DROP TABLE users; --"
        result = self.generator._sanitize_value(sql_injection)

        # While this isn't SQL injection protection per se,
        # escaping HTML entities helps prevent display-based attacks
        assert result == "&#x27;; DROP TABLE users; --"

    def test_sanitize_complex_xss_payload(self):
        """Test a complex XSS payload"""
        complex_payload = '<svg/onload=alert("XSS")>'
        result = self.generator._sanitize_value(complex_payload)

        assert "<svg" not in result
        assert "onload" not in result or "&" in result

    def test_sanitize_javascript_protocol(self):
        """Test javascript: protocol in links"""
        js_protocol = '<a href="javascript:alert(1)">Click</a>'
        result = self.generator._sanitize_value(js_protocol)

        assert "<a " not in result
        assert "javascript:" not in result or "&" in result

    def test_sanitize_data_uri_xss(self):
        """Test data URI XSS attempt"""
        data_uri = '<iframe src="data:text/html,<script>alert(1)</script>">'
        result = self.generator._sanitize_value(data_uri)

        assert "<iframe" not in result
        assert "<script" not in result or "&" in result

    def test_sanitize_long_string(self):
        """Test that long strings are handled efficiently"""
        long_string = "A" * 10000 + "<script>alert('XSS')</script>"
        result = self.generator._sanitize_value(long_string)

        assert "<script>" not in result
        assert len(result) > 0

    def test_sanitize_multiple_xss_attempts(self):
        """Test string with multiple XSS attempts"""
        multiple_xss = '<script>alert(1)</script><img src=x onerror="alert(2)"><div onclick="alert(3)">test</div>'
        result = self.generator._sanitize_value(multiple_xss)

        assert "<script>" not in result
        assert "<img" not in result
        assert "onerror" not in result or "&" in result
        assert "<div" not in result


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
