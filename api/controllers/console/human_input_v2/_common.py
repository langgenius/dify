class StrictModel(BaseModel):
    """Base request model that forbids unknown fields while accepting JSON-native values."""

    model_config = ConfigDict(extra="forbid", strict=True)
