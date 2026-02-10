from core.rag.cleaner.clean_processor import CleanProcessor


class TestCleanProcessor:
    """Test cases for CleanProcessor.clean method."""

    def test_clean_default_removal_of_invalid_symbols(self):
        """Test default cleaning removes invalid symbols."""
        # Test <| replacement
        assert CleanProcessor.clean("text<|with<|invalid", None) == "text<with<invalid"

        # Test |> replacement
        assert CleanProcessor.clean("text|>with|>invalid", None) == "text>with>invalid"

        # Test removal of control characters
        text_with_control = "normal\x00text\x1fwith\x07control\x7fchars"
        expected = "normaltextwithcontrolchars"
        assert CleanProcessor.clean(text_with_control, None) == expected

        # Test U+FFFE removal
        text_with_ufffe = "normal\ufffepadding"
        expected = "normalpadding"
        assert CleanProcessor.clean(text_with_ufffe, None) == expected

    def test_clean_with_none_process_rule(self):
        """Test cleaning with None process_rule - only default cleaning applied."""
        text = "Hello<|World\x00"
        expected = "Hello<World"
        assert CleanProcessor.clean(text, None) == expected

    def test_clean_with_empty_process_rule(self):
        """Test cleaning with empty process_rule dict - only default cleaning applied."""
        text = "Hello<|World\x00"
        expected = "Hello<World"
        assert CleanProcessor.clean(text, {}) == expected

    def test_clean_with_empty_rules(self):
        """Test cleaning with empty rules - only default cleaning applied."""
        text = "Hello<|World\x00"
        expected = "Hello<World"
        assert CleanProcessor.clean(text, {"rules": {}}) == expected

    def test_clean_remove_extra_spaces_enabled(self):
        """Test remove_extra_spaces rule when enabled."""
        process_rule = {"rules": {"pre_processing_rules": [{"id": "remove_extra_spaces", "enabled": True}]}}

        # Test multiple newlines reduced to two
        text = "Line1\n\n\n\n\nLine2"
        expected = "Line1\n\nLine2"
        assert CleanProcessor.clean(text, process_rule) == expected

        # Test various whitespace characters reduced to single space
        text = "word1\u2000\u2001\t\t  \u3000word2"
        expected = "word1 word2"
        assert CleanProcessor.clean(text, process_rule) == expected

        # Test combination of newlines and spaces
        text = "Line1\n\n\n\n  \t  Line2"
        expected = "Line1\n\n Line2"
        assert CleanProcessor.clean(text, process_rule) == expected

    def test_clean_remove_extra_spaces_disabled(self):
        """Test remove_extra_spaces rule when disabled."""
        process_rule = {"rules": {"pre_processing_rules": [{"id": "remove_extra_spaces", "enabled": False}]}}

        text = "Line1\n\n\n\n\nLine2  with  spaces"
        # Should only apply default cleaning (no invalid symbols here)
        assert CleanProcessor.clean(text, process_rule) == text

    def test_clean_remove_urls_emails_enabled(self):
        """Test remove_urls_emails rule when enabled."""
        process_rule = {"rules": {"pre_processing_rules": [{"id": "remove_urls_emails", "enabled": True}]}}

        # Test email removal
        text = "Contact us at test@example.com for more info"
        expected = "Contact us at  for more info"
        assert CleanProcessor.clean(text, process_rule) == expected

        # Test URL removal
        text = "Visit https://example.com or http://test.org"
        expected = "Visit  or "
        assert CleanProcessor.clean(text, process_rule) == expected

        # Test both email and URL
        text = "Email me@test.com and visit https://site.com"
        expected = "Email  and visit "
        assert CleanProcessor.clean(text, process_rule) == expected

    def test_clean_preserve_markdown_links_and_images(self):
        """Test that markdown links and images are preserved when removing URLs."""
        process_rule = {"rules": {"pre_processing_rules": [{"id": "remove_urls_emails", "enabled": True}]}}

        # Test markdown link preservation
        text = "Check [Google](https://google.com) for info"
        expected = "Check [Google](https://google.com) for info"
        assert CleanProcessor.clean(text, process_rule) == expected

        # Test markdown image preservation
        text = "Image: ![alt](https://example.com/image.png)"
        expected = "Image: ![alt](https://example.com/image.png)"
        assert CleanProcessor.clean(text, process_rule) == expected

        # Test both link and image preservation
        text = "[Link](https://link.com) and ![Image](https://image.com/img.jpg)"
        expected = "[Link](https://link.com) and ![Image](https://image.com/img.jpg)"
        assert CleanProcessor.clean(text, process_rule) == expected

        # Test that non-markdown URLs are still removed
        text = "Check [Link](https://keep.com) but remove https://remove.com"
        expected = "Check [Link](https://keep.com) but remove "
        assert CleanProcessor.clean(text, process_rule) == expected

        # Test email removal alongside markdown preservation
        text = "Email: test@test.com, link: [Click](https://site.com)"
        expected = "Email: , link: [Click](https://site.com)"
        assert CleanProcessor.clean(text, process_rule) == expected

    def test_clean_remove_urls_emails_disabled(self):
        """Test remove_urls_emails rule when disabled."""
        process_rule = {"rules": {"pre_processing_rules": [{"id": "remove_urls_emails", "enabled": False}]}}

        text = "Email test@example.com visit https://example.com"
        # Should only apply default cleaning
        assert CleanProcessor.clean(text, process_rule) == text

    def test_clean_both_rules_enabled(self):
        """Test both pre-processing rules enabled together."""
        process_rule = {
            "rules": {
                "pre_processing_rules": [
                    {"id": "remove_extra_spaces", "enabled": True},
                    {"id": "remove_urls_emails", "enabled": True},
                ]
            }
        }

        text = "Hello\n\n\n\n  World  test@example.com  \n\n\nhttps://example.com"
        expected = "Hello\n\n World  \n\n"
        assert CleanProcessor.clean(text, process_rule) == expected

    def test_clean_with_markdown_link_and_extra_spaces(self):
        """Test markdown link preservation with extra spaces removal."""
        process_rule = {
            "rules": {
                "pre_processing_rules": [
                    {"id": "remove_extra_spaces", "enabled": True},
                    {"id": "remove_urls_emails", "enabled": True},
                ]
            }
        }

        text = "[Link](https://example.com)\n\n\n\n  Text  https://remove.com"
        expected = "[Link](https://example.com)\n\n Text "
        assert CleanProcessor.clean(text, process_rule) == expected

    def test_clean_unknown_rule_id_ignored(self):
        """Test that unknown rule IDs are silently ignored."""
        process_rule = {"rules": {"pre_processing_rules": [{"id": "unknown_rule", "enabled": True}]}}

        text = "Hello<|World\x00"
        expected = "Hello<World"
        # Only default cleaning should be applied
        assert CleanProcessor.clean(text, process_rule) == expected

    def test_clean_empty_text(self):
        """Test cleaning empty text."""
        assert CleanProcessor.clean("", None) == ""
        assert CleanProcessor.clean("", {}) == ""
        assert CleanProcessor.clean("", {"rules": {}}) == ""

    def test_clean_text_with_only_invalid_symbols(self):
        """Test text containing only invalid symbols."""
        text = "<|<|\x00\x01\x02\ufffe|>|>"
        # <| becomes <, |> becomes >, control chars and U+FFFE are removed
        assert CleanProcessor.clean(text, None) == "<<>>"

    def test_clean_multiple_markdown_links_preserved(self):
        """Test multiple markdown links are all preserved."""
        process_rule = {"rules": {"pre_processing_rules": [{"id": "remove_urls_emails", "enabled": True}]}}

        text = "[One](https://one.com) [Two](http://two.org) [Three](https://three.net)"
        expected = "[One](https://one.com) [Two](http://two.org) [Three](https://three.net)"
        assert CleanProcessor.clean(text, process_rule) == expected

    def test_clean_markdown_link_text_as_url(self):
        """Test markdown link where the link text itself is a URL."""
        process_rule = {"rules": {"pre_processing_rules": [{"id": "remove_urls_emails", "enabled": True}]}}

        # Link text that looks like URL should be preserved
        text = "[https://text-url.com](https://actual-url.com)"
        expected = "[https://text-url.com](https://actual-url.com)"
        assert CleanProcessor.clean(text, process_rule) == expected

        # Text URL without markdown should be removed
        text = "https://text-url.com https://actual-url.com"
        expected = " "
        assert CleanProcessor.clean(text, process_rule) == expected

    def test_clean_complex_markdown_link_content(self):
        """Test markdown links with complex content - known limitation with brackets in link text."""
        process_rule = {"rules": {"pre_processing_rules": [{"id": "remove_urls_emails", "enabled": True}]}}

        # Note: The regex pattern [^\]]* cannot handle ] within link text
        # This is a known limitation - the pattern stops at the first ]
        text = "[Text with [brackets] and (parens)](https://example.com)"
        # Actual behavior: only matches up to first ], URL gets removed
        expected = "[Text with [brackets] and (parens)]("
        assert CleanProcessor.clean(text, process_rule) == expected

        # Test that properly formatted markdown links work
        text = "[Text with (parens) and symbols](https://example.com)"
        expected = "[Text with (parens) and symbols](https://example.com)"
        assert CleanProcessor.clean(text, process_rule) == expected
