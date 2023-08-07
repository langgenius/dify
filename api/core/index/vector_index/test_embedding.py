import numpy as np
from numpy import average
from sentence_transformers import SentenceTransformer



def test_embdding():
    sentences = ["My name is john"]

    model = SentenceTransformer('sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2')
    embeddings = model.encode(sentences)
    for embedding in embeddings:
        print(embedding)
        embedding = (embedding / np.linalg.norm(embedding)).tolist()
        print(embedding)
        embedding = (embedding / np.linalg.norm(embedding)).tolist()
        print(embedding)
    print(embeddings)
