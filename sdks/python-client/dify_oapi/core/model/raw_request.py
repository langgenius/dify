class RawRequest:
    def __init__(self):
        self.uri: str | None = None
        self.headers: dict[str, str] = {}
        self.body: bytes | None = None
