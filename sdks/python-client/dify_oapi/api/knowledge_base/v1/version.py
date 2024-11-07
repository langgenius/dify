from dify_oapi.core.model.config import Config

from .resource import Dataset, Document, Segment


class V1:
    def __init__(self, config: Config):
        self.dataset: Dataset = Dataset(config)
        self.document: Document = Document(config)
        self.segment: Segment = Segment(config)
