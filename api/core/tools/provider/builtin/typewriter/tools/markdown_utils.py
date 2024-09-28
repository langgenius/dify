import markdown


class MarkdownUtils:
    CSS_FOR_TABLE = """
    <!-- CSS for table -->
    <style>
        table, th, td {
            border: 1px solid;
        }
        table {
            width: 100%;
        }
    </style>
    """

    @classmethod
    def convert_markdown_to_html(cls, markdown_text: str) -> str:
        # official supported Markdown extensions:
        # https://python-markdown.github.io/extensions/#officially-supported-extensions
        extensions = ["extra", "toc"]
        html = markdown.markdown(text=markdown_text, extensions=extensions)
        return f"""
        {html}
        {cls.CSS_FOR_TABLE if "<table>" in html else ""}
        """

    @staticmethod
    def strip_markdown_wrapper(markdown_text: str) -> str:
        # removing leading and trailing whitespaces
        markdown_text = markdown_text.strip()

        # removing codeblock wrapper if existed
        wrapper = "```"
        if markdown_text.endswith(wrapper):
            if markdown_text.startswith(wrapper):
                markdown_text = markdown_text[len(wrapper) : -len(wrapper)]
            elif markdown_text.startswith(f"{wrapper}markdown"):
                markdown_text = markdown_text[(len(f"{wrapper}markdown")) : -len(wrapper)]

        return markdown_text
