from core.vector_store.vector_store import VectorStore

vector_store = VectorStore()


def init_app(app):
    vector_store.init_app(app)
