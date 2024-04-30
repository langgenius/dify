from core.rag.extractor.pdf.openparse import DocumentParser, processing
from core.rag.extractor.pdf.openparse.schemas import ImageElement

if __name__ == '__main__':
    """Lazy load given path as pages."""
    # blob = Blob.from_path(self._file_path)
    # yield from self.parse(blob)
    # file_path = "/Users/chenxu/Desktop/未命名文件夹/腾讯云向量数据库产品介绍-对外(PPT版)-20230102更新.pdf"
    file_path = "pdf file path here"
    documents = []
    parser = DocumentParser(
        processing_pipeline=processing.BasicIngestionPipeline(),
        table_args={
            "parsing_algorithm": "pymupdf",
            "table_output_format": "markdown"
        }
    )
    parsed_basic_doc = parser.parse(file_path)
    documentContent = ''
    for _index, node in enumerate(parsed_basic_doc.nodes):
        metadata = {"source": file_path, "page": _index}
        for element in node.elements:
            if isinstance(element, ImageElement):
                # pdf images a
                pass
            else:
                print(element.text)
