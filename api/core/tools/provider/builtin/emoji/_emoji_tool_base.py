import os
import torch
from urllib.parse import urljoin
from langchain_community.embeddings import HuggingFaceBgeEmbeddings
from langchain_community.vectorstores import FAISS


class EmojiToolBase:
    def __init__(self, emo_vector_path: str, embedding_model_path: str, emo_data_path: str) -> None:
        self.embeddings = HuggingFaceBgeEmbeddings(model_name=embedding_model_path)
        self.vector_store = FAISS.load_local(emo_vector_path, self.embeddings, allow_dangerous_deserialization=True)
        self.emo_data_path = emo_data_path

    def _search_emoji(self, query: str, sim_p: float = 0.4) -> str:
        search_result = self.vector_store.similarity_search_with_score(query=query, k=2)
        search_result = sorted(search_result, key=lambda x: x[1], reverse=False)
        self._torch_gc()
        for res in search_result:
            if res[1] > sim_p:
                filename = res[0].metadata["filename"]
                # return os.path.join(self.emo_data_path, filename)
                return urljoin(self.emo_data_path, filename)
        return None

    def _torch_gc(self):
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
