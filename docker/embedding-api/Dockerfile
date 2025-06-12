FROM python:3.10-slim

WORKDIR /app
COPY embedding_api.py .

RUN pip install fastapi uvicorn sentence-transformers

CMD ["uvicorn", "embedding_api:app", "--host", "0.0.0.0", "--port", "8001"]
