import re
from typing import Any


class CleanProcessor:
    @classmethod
    def clean(cls, text: str, process_rule: dict[str, Any] | None) -> str:
        # default clean
        # remove invalid symbol
        text = re.sub(r"<\|", "<", text)
        text = re.sub(r"\|>", ">", text)
        text = re.sub(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]", "", text)
        # Unicode  U+FFFE
        text = re.sub("\ufffe", "", text)

        rules = process_rule["rules"] if process_rule else {}
        if "pre_processing_rules" in rules:
            pre_processing_rules = rules["pre_processing_rules"]
            for pre_processing_rule in pre_processing_rules:
                if pre_processing_rule["id"] == "remove_extra_spaces" and pre_processing_rule["enabled"] is True:
                    # Remove extra spaces
                    pattern = r"\n{3,}"
                    text = re.sub(pattern, "\n\n", text)
                    pattern = r"[\t\f\r\x20\u00a0\u1680\u180e\u2000-\u200a\u202f\u205f\u3000]{2,}"
                    text = re.sub(pattern, " ", text)
                elif pre_processing_rule["id"] == "remove_urls_emails" and pre_processing_rule["enabled"] is True:
                    # Remove URL but keep Markdown image URLs and link URLs
                    # Replace the ENTIRE markdown link/image with a single placeholder to protect
                    # the link text (which might also be a URL) from being removed.
                    # The marker prefix is chosen after email removal so it cannot already
                    # occur in the text that will be scanned.
                    markdown_link_pattern = r"\[([^\]]*)\]\((https?://[^)]+)\)"
                    markdown_image_pattern = r"!\[.*?\]\((https?://[^)]+)\)"
                    placeholders: list[tuple[str, str, str]] = []  # (type, text, url)
                    marker_prefix = "__MARKDOWN_PLACEHOLDER_"
                    while marker_prefix in text:
                        marker_prefix += "x"

                    def replace_markdown_with_placeholder(
                        match, placeholders=placeholders, marker_prefix=marker_prefix
                    ):
                        link_type = "link"
                        link_text = match.group(1)
                        url = match.group(2)
                        placeholder = f"{marker_prefix}{len(placeholders)}__"
                        placeholders.append((link_type, link_text, url))
                        return placeholder

                    def replace_image_with_placeholder(match, placeholders=placeholders, marker_prefix=marker_prefix):
                        link_type = "image"
                        url = match.group(1)
                        placeholder = f"{marker_prefix}{len(placeholders)}__"
                        placeholders.append((link_type, "image", url))
                        return placeholder

                    # Protect markdown links first
                    text = re.sub(markdown_link_pattern, replace_markdown_with_placeholder, text)
                    # Then protect markdown images
                    text = re.sub(markdown_image_pattern, replace_image_with_placeholder, text)

                    # Remove email (after protection so Markdown link/image URLs are left intact)
                    pattern = r"([a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)"
                    text = re.sub(pattern, "", text)

                    # Now remove all remaining URLs
                    url_pattern = r"https?://\S+"
                    text = re.sub(url_pattern, "", text)

                    # Restore every protected link in one pass so a marker that appears
                    # inside an earlier link is not rewritten by a later replacement.
                    def restore_markdown(match, placeholders=placeholders):
                        index = int(match.group(1))
                        if index >= len(placeholders):
                            return match.group(0)
                        link_type, text_or_alt, url = placeholders[index]
                        if link_type == "link":
                            return f"[{text_or_alt}]({url})"
                        return f"![{text_or_alt}]({url})"

                    if placeholders:
                        text = re.sub(re.escape(marker_prefix) + r"(\d+)__", restore_markdown, text)
        return text

    def filter_string(self, text):
        return text
