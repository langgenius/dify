import hashlib
import json
import mimetypes
import os
import re
import site
import subprocess
import tempfile
import unicodedata
from contextlib import contextmanager
from pathlib import Path
from typing import Optional
from urllib.parse import unquote

import chardet
import cloudscraper
from bs4 import BeautifulSoup, CData, Comment, NavigableString
from regex import regex

from core.helper import ssrf_proxy
from core.rag.extractor import extract_processor
from core.rag.extractor.extract_processor import ExtractProcessor

FULL_TEMPLATE = """
TITLE: {title}
AUTHORS: {authors}
PUBLISH DATE: {publish_date}
TOP_IMAGE_URL: {top_image}
TEXT:

{text}
"""


def page_result(text: str, cursor: int, max_length: int) -> str:
    """Page through `text` and return a substring of `max_length` characters starting from `cursor`."""
    return text[cursor : cursor + max_length]


def get_url(url: str, user_agent: Optional[str] = None) -> str:
    """Fetch URL and return the contents as a string."""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
        " Chrome/91.0.4472.124 Safari/537.36"
    }
    if user_agent:
        headers["User-Agent"] = user_agent

    main_content_type = None
    supported_content_types = extract_processor.SUPPORT_URL_CONTENT_TYPES + ["text/html"]
    response = ssrf_proxy.head(url, headers=headers, follow_redirects=True, timeout=(5, 10))

    if response.status_code == 200:
        # check content-type
        content_type = response.headers.get("Content-Type")
        if content_type:
            main_content_type = response.headers.get("Content-Type").split(";")[0].strip()
        else:
            content_disposition = response.headers.get("Content-Disposition", "")
            filename_match = re.search(r'filename="([^"]+)"', content_disposition)
            if filename_match:
                filename = unquote(filename_match.group(1))
                extension = re.search(r"\.(\w+)$", filename)
                if extension:
                    main_content_type = mimetypes.guess_type(filename)[0]

        if main_content_type not in supported_content_types:
            return "Unsupported content-type [{}] of URL.".format(main_content_type)

        if main_content_type in extract_processor.SUPPORT_URL_CONTENT_TYPES:
            return ExtractProcessor.load_from_url(url, return_text=True)

        response = ssrf_proxy.get(url, headers=headers, follow_redirects=True, timeout=(120, 300))
    elif response.status_code == 403:
        scraper = cloudscraper.create_scraper()
        scraper.perform_request = ssrf_proxy.make_request
        response = scraper.get(url, headers=headers, follow_redirects=True, timeout=(120, 300))

    if response.status_code != 200:
        return "URL returned status code {}.".format(response.status_code)

    # Detect encoding using chardet
    detected_encoding = chardet.detect(response.content)
    encoding = detected_encoding["encoding"]
    if encoding:
        try:
            content = response.content.decode(encoding)
        except (UnicodeDecodeError, TypeError):
            content = response.text
    else:
        content = response.text

    a = extract_using_readabilipy(content)

    if not a["plain_text"] or not a["plain_text"].strip():
        return ""

    res = FULL_TEMPLATE.format(
        title=a["title"],
        authors=a["byline"],
        publish_date=a["date"],
        top_image="",
        text=a["plain_text"] or "",
    )

    return res


def extract_using_readabilipy(html):
    with tempfile.NamedTemporaryFile(delete=False, mode="w+") as f_html:
        f_html.write(html)
        f_html.close()
    html_path = f_html.name

    # Call Mozilla's Readability.js Readability.parse() function via node, writing output to a temporary file
    article_json_path = html_path + ".json"
    jsdir = os.path.join(find_module_path("readabilipy"), "javascript")
    with chdir(jsdir):
        subprocess.check_call(["node", "ExtractArticle.js", "-i", html_path, "-o", article_json_path])

    # Read output of call to Readability.parse() from JSON file and return as Python dictionary
    input_json = json.loads(Path(article_json_path).read_text(encoding="utf-8"))

    # Deleting files after processing
    os.unlink(article_json_path)
    os.unlink(html_path)

    article_json = {
        "title": None,
        "byline": None,
        "date": None,
        "content": None,
        "plain_content": None,
        "plain_text": None,
    }
    # Populate article fields from readability fields where present
    if input_json:
        if input_json.get("title"):
            article_json["title"] = input_json["title"]
        if input_json.get("byline"):
            article_json["byline"] = input_json["byline"]
        if input_json.get("date"):
            article_json["date"] = input_json["date"]
        if input_json.get("content"):
            article_json["content"] = input_json["content"]
            article_json["plain_content"] = plain_content(article_json["content"], False, False)
            article_json["plain_text"] = extract_text_blocks_as_plain_text(article_json["plain_content"])
        if input_json.get("textContent"):
            article_json["plain_text"] = input_json["textContent"]
            article_json["plain_text"] = re.sub(r"\n\s*\n", "\n", article_json["plain_text"])

    return article_json


def find_module_path(module_name):
    for package_path in site.getsitepackages():
        potential_path = os.path.join(package_path, module_name)
        if os.path.exists(potential_path):
            return potential_path

    return None


@contextmanager
def chdir(path):
    """Change directory in context and return to original on exit"""
    # From https://stackoverflow.com/a/37996581, couldn't find a built-in
    original_path = os.getcwd()
    os.chdir(path)
    try:
        yield
    finally:
        os.chdir(original_path)


def extract_text_blocks_as_plain_text(paragraph_html):
    # Load article as DOM
    soup = BeautifulSoup(paragraph_html, "html.parser")
    # Select all lists
    list_elements = soup.find_all(["ul", "ol"])
    # Prefix text in all list items with "* " and make lists paragraphs
    for list_element in list_elements:
        plain_items = "".join(
            list(filter(None, [plain_text_leaf_node(li)["text"] for li in list_element.find_all("li")]))
        )
        list_element.string = plain_items
        list_element.name = "p"
    # Select all text blocks
    text_blocks = [s.parent for s in soup.find_all(string=True)]
    text_blocks = [plain_text_leaf_node(block) for block in text_blocks]
    # Drop empty paragraphs
    text_blocks = list(filter(lambda p: p["text"] is not None, text_blocks))
    return text_blocks


def plain_text_leaf_node(element):
    # Extract all text, stripped of any child HTML elements and normalize it
    plain_text = normalize_text(element.get_text())
    if plain_text != "" and element.name == "li":
        plain_text = "* {}, ".format(plain_text)
    if plain_text == "":
        plain_text = None
    if "data-node-index" in element.attrs:
        plain = {"node_index": element["data-node-index"], "text": plain_text}
    else:
        plain = {"text": plain_text}
    return plain


def plain_content(readability_content, content_digests, node_indexes):
    # Load article as DOM
    soup = BeautifulSoup(readability_content, "html.parser")
    # Make all elements plain
    elements = plain_elements(soup.contents, content_digests, node_indexes)
    if node_indexes:
        # Add node index attributes to nodes
        elements = [add_node_indexes(element) for element in elements]
    # Replace article contents with plain elements
    soup.contents = elements
    return str(soup)


def plain_elements(elements, content_digests, node_indexes):
    # Get plain content versions of all elements
    elements = [plain_element(element, content_digests, node_indexes) for element in elements]
    if content_digests:
        # Add content digest attribute to nodes
        elements = [add_content_digest(element) for element in elements]
    return elements


def plain_element(element, content_digests, node_indexes):
    # For lists, we make each item plain text
    if is_leaf(element):
        # For leaf node elements, extract the text content, discarding any HTML tags
        # 1. Get element contents as text
        plain_text = element.get_text()
        # 2. Normalize the extracted text string to a canonical representation
        plain_text = normalize_text(plain_text)
        # 3. Update element content to be plain text
        element.string = plain_text
    elif is_text(element):
        if is_non_printing(element):
            # The simplified HTML may have come from Readability.js so might
            # have non-printing text (e.g. Comment or CData). In this case, we
            # keep the structure, but ensure that the string is empty.
            element = type(element)("")
        else:
            plain_text = element.string
            plain_text = normalize_text(plain_text)
            element = type(element)(plain_text)
    else:
        # If not a leaf node or leaf type call recursively on child nodes, replacing
        element.contents = plain_elements(element.contents, content_digests, node_indexes)
    return element


def add_node_indexes(element, node_index="0"):
    # Can't add attributes to string types
    if is_text(element):
        return element
    # Add index to current element
    element["data-node-index"] = node_index
    # Add index to child elements
    for local_idx, child in enumerate([c for c in element.contents if not is_text(c)], start=1):
        # Can't add attributes to leaf string types
        child_index = "{stem}.{local}".format(stem=node_index, local=local_idx)
        add_node_indexes(child, node_index=child_index)
    return element


def normalize_text(text):
    """Normalize unicode and whitespace."""
    # Normalize unicode first to try and standardize whitespace characters as much as possible before normalizing them
    text = strip_control_characters(text)
    text = normalize_unicode(text)
    text = normalize_whitespace(text)
    return text


def strip_control_characters(text):
    """Strip out unicode control characters which might break the parsing."""
    # Unicode control characters
    #   [Cc]: Other, Control [includes new lines]
    #   [Cf]: Other, Format
    #   [Cn]: Other, Not Assigned
    #   [Co]: Other, Private Use
    #   [Cs]: Other, Surrogate
    control_chars = {"Cc", "Cf", "Cn", "Co", "Cs"}
    retained_chars = ["\t", "\n", "\r", "\f"]

    # Remove non-printing control characters
    return "".join(
        [
            "" if (unicodedata.category(char) in control_chars) and (char not in retained_chars) else char
            for char in text
        ]
    )


def normalize_unicode(text):
    """Normalize unicode such that things that are visually equivalent map to the same unicode string where possible."""
    normal_form = "NFKC"
    text = unicodedata.normalize(normal_form, text)
    return text


def normalize_whitespace(text):
    """Replace runs of whitespace characters with a single space as this is what happens when HTML text is displayed."""
    text = regex.sub(r"\s+", " ", text)
    # Remove leading and trailing whitespace
    text = text.strip()
    return text


def is_leaf(element):
    return element.name in {"p", "li"}


def is_text(element):
    return isinstance(element, NavigableString)


def is_non_printing(element):
    return any(isinstance(element, _e) for _e in [Comment, CData])


def add_content_digest(element):
    if not is_text(element):
        element["data-content-digest"] = content_digest(element)
    return element


def content_digest(element):
    if is_text(element):
        # Hash
        trimmed_string = element.string.strip()
        if trimmed_string == "":
            digest = ""
        else:
            digest = hashlib.sha256(trimmed_string.encode("utf-8")).hexdigest()
    else:
        contents = element.contents
        num_contents = len(contents)
        if num_contents == 0:
            # No hash when no child elements exist
            digest = ""
        elif num_contents == 1:
            # If single child, use digest of child
            digest = content_digest(contents[0])
        else:
            # Build content digest from the "non-empty" digests of child nodes
            digest = hashlib.sha256()
            child_digests = list(filter(lambda x: x != "", [content_digest(content) for content in contents]))
            for child in child_digests:
                digest.update(child.encode("utf-8"))
            digest = digest.hexdigest()
    return digest
