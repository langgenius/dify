from fastapi import FastAPI
from pydantic import BaseModel
from typing import List
from sentence_transformers import SentenceTransformer

app = FastAPI()
model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")

class EmbeddingRequest(BaseModel):
    input: List[str]

@app.post("/v1/embeddings")
async def embed(request: EmbeddingRequest):
    embeddings = model.encode(request.input).tolist()
    return {
        "data": [{"embedding": emb, "index": i} for i, emb in enumerate(embeddings)],
        "model": "sentence-transformers/all-MiniLM-L6-v2",
        "object": "list"
    }
