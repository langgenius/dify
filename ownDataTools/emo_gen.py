import os
import json
from glob import glob
from typing import Generator, List, Tuple

from langchain_community.embeddings import HuggingFaceBgeEmbeddings
from langchain_community.vectorstores import FAISS

CACHE_EMO_PATH = "cache/emo/vector"
EMBEDDING_MODEL_NAME = "/home/data/cipher/model/Xorbits/bge-m3"
EMO_DATA_PATH = "/home/data/cipher/data/emo"

embeddings = HuggingFaceBgeEmbeddings(model_name=EMBEDDING_MODEL_NAME)


def encoding_question(path: str) -> Generator[Tuple[str, str], None, None]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.loads(f.read())
    for name_content in data:
        name = name_content["filename"]
        content = name_content["content"]
        yield name, content


def save_vector(paths: List[str]):
    names = []
    contents = []
    for json_path in paths:
        for name, content in encoding_question(json_path):
            names.append({"filename": name})
            contents.append(content)
    db_fai = FAISS.from_texts(contents, embeddings, metadatas=names)
    db_fai.save_local(CACHE_EMO_PATH)


vector_store = FAISS.load_local(
    CACHE_EMO_PATH, embeddings, allow_dangerous_deserialization=True
)


def get_emo(content: str, sim_p: float = 0.4):
    search_result = vector_store.similarity_search_with_score(query=content, k=2)
    search_result = sorted(search_result, key=lambda x: x[1], reverse=False)
    for res in search_result:
        if res[1] > sim_p:
            filename = res[0].metadata["filename"]
            return os.path.join(EMO_DATA_PATH, filename)
    return None


def create_emo_vector():
    pathname = "cache/emo/*.json"
    save_vector(glob(pathname))


if __name__ == "__main__":
    # create_emo_vector()
    content = "好无聊啊"
    emopath = get_emo(content)
    print(emopath)
    print()
