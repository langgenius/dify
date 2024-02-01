import hashlib
import json
import os
import re
import site
import subprocess
import tempfile
import unicodedata
from contextlib import contextmanager
from typing import Any, Type

import requests
from bs4 import BeautifulSoup, CData, Comment, NavigableString
from core.chain.llm_chain import LLMChain
from core.data_loader import file_extractor
from core.data_loader.file_extractor import FileExtractor
from core.entities.application_entities import ModelConfigEntity
from langchain.chains import RefineDocumentsChain
from langchain.chains.summarize import refine_prompts
from langchain.schema import Document
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.tools.base import BaseTool
from newspaper import Article
from pydantic import BaseModel, Field
from regex import regex

FULL_TEMPLATE = """
TITLE: {title}
AUTHORS: {authors}
PUBLISH DATE: {publish_date}
TOP_IMAGE_URL: {top_image}
TEXT:

{text}
"""


class WebReaderToolInput(BaseModel):
    url: str = Field(..., description="URL of the website to read")
    summary: bool = Field(
        default=False,
        description="When the user's question requires extracting the summarizing content of the webpage, "
                    "set it to true."
    )
    cursor: int = Field(
        default=0,
        description="Start reading from this character."
        "Use when the first response was truncated"
        "and you want to continue reading the page."
        "The value cannot exceed 24000.",
    )


class WebReaderTool(BaseTool):
    """Reader tool for getting website title and contents. Gives more control than SimpleReaderTool."""

    name: str = "web_reader"
    args_schema: Type[BaseModel] = WebReaderToolInput
    description: str = "use this to read a website. " \
                       "If you can answer the question based on the information provided, " \
                       "there is no need to use."
    page_contents: str = None
    url: str = None
    max_chunk_length: int = 4000
    summary_chunk_tokens: int = 4000
    summary_chunk_overlap: int = 0
    summary_separators: list[str] = ["\n\n", "。", ".", " ", ""]
    continue_reading: bool = True
    model_config: ModelConfigEntity
    model_parameters: dict[str, Any]

    def _run(self, url: str, summary: bool = False, cursor: int = 0) -> str:
        try:
            if not self.page_contents or self.url != url:
                page_contents = get_url(url)
                self.page_contents = page_contents
                self.url = url
            else:
                page_contents = self.page_contents
        except Exception as e:
            return f'Read this website failed, caused by: {str(e)}.'

        if summary:
            character_splitter = RecursiveCharacterTextSplitter.from_tiktoken_encoder(
                chunk_size=self.summary_chunk_tokens,
                chunk_overlap=self.summary_chunk_overlap,
                separators=self.summary_separators
            )

            texts = character_splitter.split_text(page_contents)
            docs = [Document(page_content=t) for t in texts]

            if len(docs) == 0 or docs[0].page_content.endswith('TEXT:'):
                return "No content found."

            # only use first 5 docs
            if len(docs) > 5:
                docs = docs[:5]

            chain = self.get_summary_chain()
            try:
                page_contents = chain.run(docs)
            except Exception as e:
                return f'Read this website failed, caused by: {str(e)}.'
        else:
            page_contents = page_result(page_contents, cursor, self.max_chunk_length)

            if self.continue_reading and len(page_contents) >= self.max_chunk_length:
                page_contents += f"\nPAGE WAS TRUNCATED. IF YOU FIND INFORMATION THAT CAN ANSWER QUESTION " \
                                 f"THEN DIRECT ANSWER AND STOP INVOKING web_reader TOOL, OTHERWISE USE " \
                                 f"CURSOR={cursor+len(page_contents)} TO CONTINUE READING."

        return page_contents

    async def _arun(self, url: str) -> str:
        raise NotImplementedError

    def get_summary_chain(self) -> RefineDocumentsChain:
        initial_chain = LLMChain(
            model_config=self.model_config,
            prompt=refine_prompts.PROMPT,
            parameters=self.model_parameters
        )
        refine_chain = LLMChain(
            model_config=self.model_config,
            prompt=refine_prompts.REFINE_PROMPT,
            parameters=self.model_parameters
        )
        return RefineDocumentsChain(
            initial_llm_chain=initial_chain,
            refine_llm_chain=refine_chain,
            document_variable_name="text",
            initial_response_name="existing_answer",
            callbacks=self.callbacks
        )


def page_result(text: str, cursor: int, max_length: int) -> str:
    """Page through `text` and return a substring of `max_length` characters starting from `cursor`."""
    return text[cursor: cursor + max_length]


def get_url(url: str, user_agent: str = None) -> str:
    """Fetch URL and return the contents as a string."""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    }
    if user_agent:
        headers["User-Agent"] = user_agent
    
    supported_content_types = file_extractor.SUPPORT_URL_CONTENT_TYPES + ["text/html"]

    head_response = requests.head(url, headers=headers, allow_redirects=True, timeout=(5, 10))

    if head_response.status_code != 200:
        return "URL returned status code {}.".format(head_response.status_code)

    # check content-type
    main_content_type = head_response.headers.get('Content-Type').split(';')[0].strip()
    if main_content_type not in supported_content_types:
        return "Unsupported content-type [{}] of URL.".format(main_content_type)

    if main_content_type in file_extractor.SUPPORT_URL_CONTENT_TYPES:
        return FileExtractor.load_from_url(url, return_text=True)

    response = requests.get(url, headers=headers, allow_redirects=True, timeout=(5, 30))
    a = extract_using_readabilipy(response.text)

    if not a['plain_text'] or not a['plain_text'].strip():
        return get_url_from_newspaper3k(url)

    res = FULL_TEMPLATE.format(
        title=a['title'],
        authors=a['byline'],
        publish_date=a['date'],
        top_image="",
        text=a['plain_text'] if a['plain_text'] else "",
    )

    return res


def get_url_from_newspaper3k(url: str) -> str:

    a = Article(url)
    a.download()
    a.parse()

    res = FULL_TEMPLATE.format(
        title=a.title,
        authors=a.authors,
        publish_date=a.publish_date,
        top_image=a.top_image,
        text=a.text,
    )

    return res


def extract_using_readabilipy(html):
    with tempfile.NamedTemporaryFile(delete=False, mode='w+') as f_html:
        f_html.write(html)
        f_html.close()
    html_path = f_html.name

    # Call Mozilla's Readability.js Readability.parse() function via node, writing output to a temporary file
    article_json_path = html_path + ".json"
    jsdir = os.path.join(find_module_path('readabilipy'), 'javascript')
    with chdir(jsdir):
        subprocess.check_call(["node", "ExtractArticle.js", "-i", html_path, "-o", article_json_path])

    # Read output of call to Readability.parse() from JSON file and return as Python dictionary
    with open(article_json_path, "r", encoding="utf-8") as json_file:
        input_json = json.loads(json_file.read())

    # Deleting files after processing
    os.unlink(article_json_path)
    os.unlink(html_path)

    article_json = {
        "title": None,
        "byline": None,
        "date": None,
        "content": None,
        "plain_content": None,
        "plain_text": None
    }
    # Populate article fields from readability fields where present
    if input_json:
        if "title" in input_json and input_json["title"]:
            article_json["title"] = input_json["title"]
        if "byline" in input_json and input_json["byline"]:
            article_json["byline"] = input_json["byline"]
        if "date" in input_json and input_json["date"]:
            article_json["date"] = input_json["date"]
        if "content" in input_json and input_json["content"]:
            article_json["content"] = input_json["content"]
            article_json["plain_content"] = plain_content(article_json["content"], False, False)
            article_json["plain_text"] = extract_text_blocks_as_plain_text(article_json["plain_content"])
        if "textContent" in input_json and input_json["textContent"]:
            article_json["plain_text"] = input_json["textContent"]
            article_json["plain_text"] = re.sub(r'\n\s*\n', '\n', article_json["plain_text"])

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
    soup = BeautifulSoup(paragraph_html, 'html.parser')
    # Select all lists
    list_elements = soup.find_all(['ul', 'ol'])
    # Prefix text in all list items with "* " and make lists paragraphs
    for list_element in list_elements:
        plain_items = "".join(list(filter(None, [plain_text_leaf_node(li)["text"] for li in list_element.find_all('li')])))
        list_element.string = plain_items
        list_element.name = "p"
    # Select all text blocks
    text_blocks = [s.parent for s in soup.find_all(string=True)]
    text_blocks = [plain_text_leaf_node(block) for block in text_blocks]
    # Drop empty paragraphs
    text_blocks = list(filter(lambda p: p["text"] is not None, text_blocks))
    return text_blocks


def plain_text_leaf_node(element):
    # Extract all text, stripped of any child HTML elements and normalise it
    plain_text = normalise_text(element.get_text())
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
    soup = BeautifulSoup(readability_content, 'html.parser')
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
    elements = [plain_element(element, content_digests, node_indexes)
                for element in elements]
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
        # 2. Normalise the extracted text string to a canonical representation
        plain_text = normalise_text(plain_text)
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
            plain_text = normalise_text(plain_text)
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
    for local_idx, child in enumerate(
            [c for c in element.contents if not is_text(c)], start=1):
        # Can't add attributes to leaf string types
        child_index = "{stem}.{local}".format(
            stem=node_index, local=local_idx)
        add_node_indexes(child, node_index=child_index)
    return element


def normalise_text(text):
    """Normalise unicode and whitespace."""
    # Normalise unicode first to try and standardise whitespace characters as much as possible before normalising them
    text = strip_control_characters(text)
    text = normalise_unicode(text)
    text = normalise_whitespace(text)
    return text


def strip_control_characters(text):
    """Strip out unicode control characters which might break the parsing."""
    # Unicode control characters
    #   [Cc]: Other, Control [includes new lines]
    #   [Cf]: Other, Format
    #   [Cn]: Other, Not Assigned
    #   [Co]: Other, Private Use
    #   [Cs]: Other, Surrogate
    control_chars = set(['Cc', 'Cf', 'Cn', 'Co', 'Cs'])
    retained_chars = ['\t', '\n', '\r', '\f']

    # Remove non-printing control characters
    return "".join(["" if (unicodedata.category(char) in control_chars) and (char not in retained_chars) else char for char in text])


def normalise_unicode(text):
    """Normalise unicode such that things that are visually equivalent map to the same unicode string where possible."""
    normal_form = "NFKC"
    text = unicodedata.normalize(normal_form, text)
    return text


def normalise_whitespace(text):
    """Replace runs of whitespace characters with a single space as this is what happens when HTML text is displayed."""
    text = regex.sub(r"\s+", " ", text)
    # Remove leading and trailing whitespace
    text = text.strip()
    return text

def is_leaf(element):
    return (element.name in ['p', 'li'])


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
            digest = hashlib.sha256(trimmed_string.encode('utf-8')).hexdigest()
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
            child_digests = list(
                filter(lambda x: x != "", [content_digest(content) for content in contents]))
            for child in child_digests:
                digest.update(child.encode('utf-8'))
            digest = digest.hexdigest()
    return digest
