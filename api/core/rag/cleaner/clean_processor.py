import re


class CleanProcessor:
    @classmethod
    def clean(cls, text: str, process_rule: dict) -> str:
        # default clean
        # remove invalid symbol
        text = re.sub(r"<\|", "<", text)
        text = re.sub(r"\|>", ">", text)
        text = re.sub(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\xEF\xBF\xBE]", "", text)
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
                    # Remove email
                    pattern = r"([a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)"
                    text = re.sub(pattern, "", text)

                    # Remove URL but keep Markdown image URLs and link URLs
                    # Replace the ENTIRE markdown link/image with a single placeholder to protect
                    # the link text (which might also be a URL) from being removed
                    markdown_link_pattern = r"\[([^\]]*)\]\((https?://[^)]+)\)"
                    markdown_image_pattern = r"!\[.*?\]\((https?://[^)]+)\)"
                    placeholders: list[tuple[str, str, str]] = []  # (type, text, url)

                    def replace_markdown_with_placeholder(match, placeholders=placeholders):
                        link_type = "link"
                        link_text = match.group(1)
                        url = match.group(2)
                        placeholder = f"__MARKDOWN_PLACEHOLDER_{len(placeholders)}__"
                        placeholders.append((link_type, link_text, url))
                        return placeholder

                    def replace_image_with_placeholder(match, placeholders=placeholders):
                        link_type = "image"
                        url = match.group(1)
                        placeholder = f"__MARKDOWN_PLACEHOLDER_{len(placeholders)}__"
                        placeholders.append((link_type, "image", url))
                        return placeholder

                    # Protect markdown links first
                    text = re.sub(markdown_link_pattern, replace_markdown_with_placeholder, text)
                    # Then protect markdown images
                    text = re.sub(markdown_image_pattern, replace_image_with_placeholder, text)

                    # Now remove all remaining URLs
                    url_pattern = r"https?://\S+"
                    text = re.sub(url_pattern, "", text)

                    # Restore the Markdown links and images
                    for i, (link_type, text_or_alt, url) in enumerate(placeholders):
                        placeholder = f"__MARKDOWN_PLACEHOLDER_{i}__"
                        if link_type == "link":
                            text = text.replace(placeholder, f"[{text_or_alt}]({url})")
                        else:  # image
                            text = text.replace(placeholder, f"![{text_or_alt}]({url})")
        return text

    def filter_string(self, text):
        return text
