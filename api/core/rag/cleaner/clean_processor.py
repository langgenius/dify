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

                    # Remove URL but keep Markdown image URLs
                    # First, temporarily replace Markdown image URLs with a placeholder
                    markdown_image_pattern = r"!\[.*?\]\((https?://[^\s)]+)\)"
                    placeholders: list[str] = []

                    def replace_with_placeholder(match, placeholders=placeholders):
                        url = match.group(1)
                        placeholder = f"__MARKDOWN_IMAGE_URL_{len(placeholders)}__"
                        placeholders.append(url)
                        return f"![image]({placeholder})"

                    text = re.sub(markdown_image_pattern, replace_with_placeholder, text)

                    # Now remove all remaining URLs
                    url_pattern = r"https?://[^\s)]+"
                    text = re.sub(url_pattern, "", text)

                    # Finally, restore the Markdown image URLs
                    for i, url in enumerate(placeholders):
                        text = text.replace(f"__MARKDOWN_IMAGE_URL_{i}__", url)
        return text

    def filter_string(self, text):
        return text
