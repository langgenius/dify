class QuotaExceededError(Exception):
    """Custom exception for quota exceeded errors."""
    def __init__(self, resource: str, message: str = None):
        self.resource = resource
        self.message = message or f"Quota for resource '{resource}' exceeded."
        super().__init__(self.message)
