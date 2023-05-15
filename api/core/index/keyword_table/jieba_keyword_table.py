import re
from typing import (
    Any,
    Dict,
    List,
    Set,
    Optional
)

import jieba.analyse

from core.index.keyword_table.stopwords import STOPWORDS
from llama_index.indices.query.base import IS
from llama_index import QueryMode
from llama_index.indices.base import QueryMap
from llama_index.indices.keyword_table.base import BaseGPTKeywordTableIndex
from llama_index.indices.keyword_table.query import BaseGPTKeywordTableQuery
from llama_index.docstore import BaseDocumentStore
from llama_index.indices.postprocessor.node import (
    BaseNodePostprocessor,
)
from llama_index.indices.response.response_builder import ResponseMode
from llama_index.indices.service_context import ServiceContext
from llama_index.optimization.optimizer import BaseTokenUsageOptimizer
from llama_index.prompts.prompts import (
    QuestionAnswerPrompt,
    RefinePrompt,
    SimpleInputPrompt,
)

from core.index.query.synthesizer import EnhanceResponseSynthesizer


def jieba_extract_keywords(
        text_chunk: str,
        max_keywords: Optional[int] = None,
        expand_with_subtokens: bool = True,
) -> Set[str]:
    """Extract keywords with JIEBA tfidf."""
    keywords = jieba.analyse.extract_tags(
        sentence=text_chunk,
        topK=max_keywords,
    )

    if expand_with_subtokens:
        return set(expand_tokens_with_subtokens(keywords))
    else:
        return set(keywords)


def expand_tokens_with_subtokens(tokens: Set[str]) -> Set[str]:
    """Get subtokens from a list of tokens., filtering for stopwords."""
    results = set()
    for token in tokens:
        results.add(token)
        sub_tokens = re.findall(r"\w+", token)
        if len(sub_tokens) > 1:
            results.update({w for w in sub_tokens if w not in list(STOPWORDS)})

    return results


class GPTJIEBAKeywordTableIndex(BaseGPTKeywordTableIndex):
    """GPT JIEBA Keyword Table Index.

    This index uses a JIEBA keyword extractor to extract keywords from the text.

    """

    def _extract_keywords(self, text: str) -> Set[str]:
        """Extract keywords from text."""
        return jieba_extract_keywords(text, max_keywords=self.max_keywords_per_chunk)

    @classmethod
    def get_query_map(self) -> QueryMap:
        """Get query map."""
        super_map = super().get_query_map()
        super_map[QueryMode.DEFAULT] = GPTKeywordTableJIEBAQuery
        return super_map

    def _delete(self, doc_id: str, **delete_kwargs: Any) -> None:
        """Delete a document."""
        # get set of ids that correspond to node
        node_idxs_to_delete = {doc_id}

        # delete node_idxs from keyword to node idxs mapping
        keywords_to_delete = set()
        for keyword, node_idxs in self._index_struct.table.items():
            if node_idxs_to_delete.intersection(node_idxs):
                self._index_struct.table[keyword] = node_idxs.difference(
                    node_idxs_to_delete
                )
                if not self._index_struct.table[keyword]:
                    keywords_to_delete.add(keyword)

        for keyword in keywords_to_delete:
            del self._index_struct.table[keyword]


class GPTKeywordTableJIEBAQuery(BaseGPTKeywordTableQuery):
    """GPT Keyword Table Index JIEBA Query.

    Extracts keywords using JIEBA keyword extractor.
    Set when `mode="jieba"` in `query` method of `GPTKeywordTableIndex`.

    .. code-block:: python

        response = index.query("<query_str>", mode="jieba")

    See BaseGPTKeywordTableQuery for arguments.

    """

    @classmethod
    def from_args(
            cls,
            index_struct: IS,
            service_context: ServiceContext,
            docstore: Optional[BaseDocumentStore] = None,
            node_postprocessors: Optional[List[BaseNodePostprocessor]] = None,
            verbose: bool = False,
            # response synthesizer args
            response_mode: ResponseMode = ResponseMode.DEFAULT,
            text_qa_template: Optional[QuestionAnswerPrompt] = None,
            refine_template: Optional[RefinePrompt] = None,
            simple_template: Optional[SimpleInputPrompt] = None,
            response_kwargs: Optional[Dict] = None,
            use_async: bool = False,
            streaming: bool = False,
            optimizer: Optional[BaseTokenUsageOptimizer] = None,
            # class-specific args
            **kwargs: Any,
    ) -> "BaseGPTIndexQuery":
        response_synthesizer = EnhanceResponseSynthesizer.from_args(
            service_context=service_context,
            text_qa_template=text_qa_template,
            refine_template=refine_template,
            simple_template=simple_template,
            response_mode=response_mode,
            response_kwargs=response_kwargs,
            use_async=use_async,
            streaming=streaming,
            optimizer=optimizer,
        )
        return cls(
            index_struct=index_struct,
            service_context=service_context,
            response_synthesizer=response_synthesizer,
            docstore=docstore,
            node_postprocessors=node_postprocessors,
            verbose=verbose,
            **kwargs,
        )

    def _get_keywords(self, query_str: str) -> List[str]:
        """Extract keywords."""
        return list(
            jieba_extract_keywords(query_str, max_keywords=self.max_keywords_per_query)
        )
