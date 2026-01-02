"""
Unit tests for XSS prevention in App payloads.

This test module validates that HTML tags, JavaScript, and other potentially
dangerous content are rejected in App names and descriptions.
"""

import pytest

from controllers.console.app.app import CopyAppPayload, CreateAppPayload, UpdateAppPayload


class TestXSSPreventionUnit:
    """Unit tests for XSS prevention in App payloads."""

    def test_create_app_valid_names(self):
        """Test CreateAppPayload with valid app names."""
        # Normal app names should be valid
        valid_names = [
            "My App",
            "Test App 123",
            "App with - dash",
            "App with _ underscore",
            "App with + plus",
            "App with () parentheses",
            "App with [] brackets",
            "App with {} braces",
            "App with ! exclamation",
            "App with @ at",
            "App with # hash",
            "App with $ dollar",
            "App with % percent",
            "App with ^ caret",
            "App with & ampersand",
            "App with * asterisk",
            "Unicode: 测试应用",
            "Emoji: 🤖",
            "Mixed: Test 测试 123",
        ]

        for name in valid_names:
            payload = CreateAppPayload(
                name=name,
                mode="chat",
            )
            assert payload.name == name

    def test_create_app_xss_script_tags(self):
        """Test CreateAppPayload rejects script tags."""
        xss_payloads = [
            "<script>alert(document.cookie)</script>",
            "<Script>alert(1)</Script>",
            "<SCRIPT>alert('XSS')</SCRIPT>",
            "<script>alert(String.fromCharCode(88,83,83))</script>",
            "<script src='evil.js'></script>",
            "<script>document.location='http://evil.com'</script>",
        ]

        for name in xss_payloads:
            with pytest.raises(ValueError) as exc_info:
                CreateAppPayload(name=name, mode="chat")
            assert "invalid characters or patterns" in str(exc_info.value).lower()

    def test_create_app_xss_iframe_tags(self):
        """Test CreateAppPayload rejects iframe tags."""
        xss_payloads = [
            "<iframe src='evil.com'></iframe>",
            "<Iframe srcdoc='<script>alert(1)</script>'></iframe>",
            "<IFRAME src='javascript:alert(1)'></iframe>",
        ]

        for name in xss_payloads:
            with pytest.raises(ValueError) as exc_info:
                CreateAppPayload(name=name, mode="chat")
            assert "invalid characters or patterns" in str(exc_info.value).lower()

    def test_create_app_xss_javascript_protocol(self):
        """Test CreateAppPayload rejects javascript: protocol."""
        xss_payloads = [
            "javascript:alert(1)",
            "JAVASCRIPT:alert(1)",
            "JavaScript:alert(document.cookie)",
            "javascript:void(0)",
            "javascript://comment%0Aalert(1)",
        ]

        for name in xss_payloads:
            with pytest.raises(ValueError) as exc_info:
                CreateAppPayload(name=name, mode="chat")
            assert "invalid characters or patterns" in str(exc_info.value).lower()

    def test_create_app_xss_svg_onload(self):
        """Test CreateAppPayload rejects SVG with onload."""
        xss_payloads = [
            "<svg onload=alert(1)>",
            "<SVG ONLOAD=alert(1)>",
            "<svg/x/onload=alert(1)>",
        ]

        for name in xss_payloads:
            with pytest.raises(ValueError) as exc_info:
                CreateAppPayload(name=name, mode="chat")
            assert "invalid characters or patterns" in str(exc_info.value).lower()

    def test_create_app_xss_event_handlers(self):
        """Test CreateAppPayload rejects HTML event handlers."""
        xss_payloads = [
            "<div onclick=alert(1)>",
            "<img onerror=alert(1)>",
            "<body onload=alert(1)>",
            "<input onfocus=alert(1)>",
            "<a onmouseover=alert(1)>",
            "<DIV ONCLICK=alert(1)>",
            "<img src=x onerror=alert(1)>",
        ]

        for name in xss_payloads:
            with pytest.raises(ValueError) as exc_info:
                CreateAppPayload(name=name, mode="chat")
            assert "invalid characters or patterns" in str(exc_info.value).lower()

    def test_create_app_xss_object_embed(self):
        """Test CreateAppPayload rejects object and embed tags."""
        xss_payloads = [
            "<object data='evil.swf'></object>",
            "<embed src='evil.swf'>",
            "<OBJECT data='javascript:alert(1)'></OBJECT>",
        ]

        for name in xss_payloads:
            with pytest.raises(ValueError) as exc_info:
                CreateAppPayload(name=name, mode="chat")
            assert "invalid characters or patterns" in str(exc_info.value).lower()

    def test_create_app_xss_link_javascript(self):
        """Test CreateAppPayload rejects link tags with javascript."""
        xss_payloads = [
            "<link href='javascript:alert(1)'>",
            "<LINK HREF='javascript:alert(1)'>",
        ]

        for name in xss_payloads:
            with pytest.raises(ValueError) as exc_info:
                CreateAppPayload(name=name, mode="chat")
            assert "invalid characters or patterns" in str(exc_info.value).lower()

    def test_create_app_xss_in_description(self):
        """Test CreateAppPayload rejects XSS in description."""
        xss_descriptions = [
            "<script>alert(1)</script>",
            "javascript:alert(1)",
            "<img onerror=alert(1)>",
        ]

        for description in xss_descriptions:
            with pytest.raises(ValueError) as exc_info:
                CreateAppPayload(
                    name="Valid Name",
                    mode="chat",
                    description=description,
                )
            assert "invalid characters or patterns" in str(exc_info.value).lower()

    def test_create_app_valid_descriptions(self):
        """Test CreateAppPayload with valid descriptions."""
        valid_descriptions = [
            "A simple description",
            "Description with < and > symbols",
            "Description with & ampersand",
            "Description with 'quotes' and \"double quotes\"",
            "Description with / slashes",
            "Description with \\ backslashes",
            "Description with ; semicolons",
            "Unicode: 这是一个描述",
            "Emoji: 🎉🚀",
        ]

        for description in valid_descriptions:
            payload = CreateAppPayload(
                name="Valid App Name",
                mode="chat",
                description=description,
            )
            assert payload.description == description

    def test_create_app_none_description(self):
        """Test CreateAppPayload with None description."""
        payload = CreateAppPayload(
            name="Valid App Name",
            mode="chat",
            description=None,
        )
        assert payload.description is None

    def test_update_app_xss_prevention(self):
        """Test UpdateAppPayload also prevents XSS."""
        xss_names = [
            "<script>alert(1)</script>",
            "javascript:alert(1)",
            "<img onerror=alert(1)>",
        ]

        for name in xss_names:
            with pytest.raises(ValueError) as exc_info:
                UpdateAppPayload(name=name)
            assert "invalid characters or patterns" in str(exc_info.value).lower()

    def test_update_app_valid_names(self):
        """Test UpdateAppPayload with valid names."""
        payload = UpdateAppPayload(name="Valid Updated Name")
        assert payload.name == "Valid Updated Name"

    def test_copy_app_xss_prevention(self):
        """Test CopyAppPayload also prevents XSS."""
        xss_names = [
            "<script>alert(1)</script>",
            "javascript:alert(1)",
            "<img onerror=alert(1)>",
        ]

        for name in xss_names:
            with pytest.raises(ValueError) as exc_info:
                CopyAppPayload(name=name)
            assert "invalid characters or patterns" in str(exc_info.value).lower()

    def test_copy_app_valid_names(self):
        """Test CopyAppPayload with valid names."""
        payload = CopyAppPayload(name="Valid Copy Name")
        assert payload.name == "Valid Copy Name"

    def test_copy_app_none_name(self):
        """Test CopyAppPayload with None name (should be allowed)."""
        payload = CopyAppPayload(name=None)
        assert payload.name is None

    def test_edge_case_angle_brackets_content(self):
        """Test that angle brackets with actual content are rejected."""
        # Angle brackets without valid HTML-like patterns should be checked
        # The regex pattern <.*?on\w+\s*= should catch event handlers
        # But let's verify other patterns too

        # Valid: angle brackets used as symbols (not matched by our patterns)
        # Our patterns specifically look for dangerous constructs

        # Invalid: actual HTML tags with event handlers
        invalid_names = [
            "<div onclick=xss>",
            "<img src=x onerror=alert(1)>",
        ]

        for name in invalid_names:
            with pytest.raises(ValueError) as exc_info:
                CreateAppPayload(name=name, mode="chat")
            assert "invalid characters or patterns" in str(exc_info.value).lower()
