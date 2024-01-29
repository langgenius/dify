"""Paragraph index processor."""
import logging
import re
import threading
import uuid
from typing import List

import pandas as pd
from flask import current_app, Flask
from flask_login import current_user
from werkzeug.datastructures import FileStorage

from core.generator.llm_generator import LLMGenerator
from core.rag.datasource.vdb.vector_init import Vector
from core.rag.extractor.extract_processor import ExtractProcessor
from core.rag.index_processor.index_processor_base import BaseIndexProcessor
from core.rag.models.document import Document
from libs import helper
from models.dataset import Dataset


class QAIndexProcessor(BaseIndexProcessor):
    def format_by_file_path(self, file_path: str, **kwargs) -> List[Document]:

        process_rule = self._process_rule

        text_docs = ExtractProcessor.load_from_file(file_path=file_path,
                                                    is_automatic=process_rule["mode"] == "automatic")
        splitter = self._get_splitter(processing_rule=process_rule,
                                      embedding_model_instance=None)

        # Split the text documents into nodes.
        all_documents = []
        all_qa_documents = []
        for text_doc in text_docs:
            # document clean
            document_text = self._document_clean(text_doc.page_content, self._process_rule)
            text_doc.page_content = document_text

            # parse document to nodes
            documents = splitter.split_documents([text_doc])
            split_documents = []
            for document_node in documents:

                if document_node.page_content.strip():
                    doc_id = str(uuid.uuid4())
                    hash = helper.generate_text_hash(document_node.page_content)
                    document_node.metadata['doc_id'] = doc_id
                    document_node.metadata['doc_hash'] = hash
                    # delete Spliter character
                    page_content = document_node.page_content
                    if page_content.startswith(".") or page_content.startswith("。"):
                        page_content = page_content[1:]
                    else:
                        page_content = page_content
                    document_node.page_content = page_content
                    split_documents.append(document_node)
            all_documents.extend(split_documents)
        for i in range(0, len(all_documents), 10):
            threads = []
            sub_documents = all_documents[i:i + 10]
            for doc in sub_documents:
                document_format_thread = threading.Thread(target=self._format_qa_document, kwargs={
                    'flask_app': current_app._get_current_object(),
                    'tenant_id': current_user.current_tenant.id,
                    'document_node': doc,
                    'all_qa_documents': all_qa_documents,
                    'document_language': kwargs.get('document_language', 'English')})
                threads.append(document_format_thread)
                document_format_thread.start()
            for thread in threads:
                thread.join()
        return all_qa_documents

    def format_by_template(self, file: FileStorage, **kwargs) -> List[Document]:

        # check file type
        if not file.filename.endswith('.csv'):
            raise ValueError("Invalid file type. Only CSV files are allowed")

        try:
            # Skip the first row
            df = pd.read_csv(file)
            text_docs = []
            for index, row in df.iterrows():
                data = Document(page_content=row[0], metadata={'answer': row[1]})
                text_docs.append(data)
            if len(text_docs) == 0:
                raise ValueError("The CSV file is empty.")

        except Exception as e:
            raise ValueError(str(e))
        return text_docs

    def load(self, dataset: Dataset, documents: List[Document]):
        vector = Vector(dataset).vector_processor
        vector.create(documents)

    def retrieve(self):
        pass

    def _format_qa_document(self, flask_app: Flask, tenant_id: str, document_node, all_qa_documents, document_language):
        format_documents = []
        if document_node.page_content is None or not document_node.page_content.strip():
            return
        with flask_app.app_context():
            try:
                # qa model document
                response = LLMGenerator.generate_qa_document(tenant_id, document_node.page_content, document_language)
                document_qa_list = self._format_split_text(response)
                qa_documents = []
                for result in document_qa_list:
                    qa_document = Document(page_content=result['question'], metadata=document_node.metadata.copy())
                    doc_id = str(uuid.uuid4())
                    hash = helper.generate_text_hash(result['question'])
                    qa_document.metadata['answer'] = result['answer']
                    qa_document.metadata['doc_id'] = doc_id
                    qa_document.metadata['doc_hash'] = hash
                    qa_documents.append(qa_document)
                format_documents.extend(qa_documents)
            except Exception as e:
                logging.exception(e)

            all_qa_documents.extend(format_documents)

    def _format_split_text(self, text):
        regex = r"Q\d+:\s*(.*?)\s*A\d+:\s*([\s\S]*?)(?=Q\d+:|$)"
        matches = re.findall(regex, text, re.UNICODE)

        return [
            {
                "question": q,
                "answer": re.sub(r"\n\s*", "\n", a.strip())
            }
            for q, a in matches if q and a
        ]
