"""Paragraph index processor."""
import re
import uuid
from typing import List

from core.model_manager import ModelManager
from core.model_runtime.entities.message_entities import SystemPromptMessage, UserPromptMessage
from core.model_runtime.entities.model_entities import ModelType
from core.rag.cleaner.cleaner_base import BaseCleaner
from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.index_processor.index_processor_base import BaseIndexProcessor
from core.rag.models.document import Document

GENERATOR_QA_PROMPT = (
    'The user will send a long text. Please think step by step.'
    'Step 1: Understand and summarize the main content of this text.\n'
    'Step 2: What key information or concepts are mentioned in this text?\n'
    'Step 3: Decompose or combine multiple pieces of information and concepts.\n'
    'Step 4: Generate 20 questions and answers based on these key information and concepts.'
    'The questions should be clear and detailed, and the answers should be detailed and complete.\n'
    "Answer MUST according to the the language:{language} and in the following format: Q1:\nA1:\nQ2:\nA2:...\n"
)


class ParagraphIndexProcessor(BaseIndexProcessor):

    def __init__(self, extractor: BaseExtractor, cleaner: BaseCleaner):
        super().__init__(extractor, cleaner)

    def format(self, documents: List[Document]):
        for document in documents:

        return documents

    def load(self, source):
        pass

    def retrieve(self):
        pass

    def generate_qa_document(self, tenant_id: str, query, document_language: str):
        # format generate qa prompt
        prompt = GENERATOR_QA_PROMPT.format(language=document_language)

        model_manager = ModelManager()
        model_instance = model_manager.get_default_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
        )

        prompt_messages = [
            SystemPromptMessage(content=prompt),
            UserPromptMessage(content=query)
        ]

        response = model_instance.invoke_llm(
            prompt_messages=prompt_messages,
            model_parameters={
                "max_tokens": 2000
            },
            stream=False
        )

        answer = response.message.content

        regex = r"Q\d+:\s*(.*?)\s*A\d+:\s*([\s\S]*?)(?=Q\d+:|$)"
        matches = re.findall(regex, answer.strip(), re.UNICODE)

        qa_list =  [
            {
                "question": q,
                "answer": re.sub(r"\n\s*", "\n", a.strip())
            }
            for q, a in matches if q and a
        ]
        qa_documents = []
        for qa_item in qa_list:
            qa_document = Document(page_content=qa_item['question'], metadata=document_node.metadata.copy())
            doc_id = str(uuid.uuid4())
            hash = helper.generate_text_hash(qa_item['question'])
            qa_document.metadata['answer'] = qa_item['answer']
            qa_document.metadata['doc_id'] = doc_id
            qa_document.metadata['doc_hash'] = hash
            qa_documents.append(qa_document)
