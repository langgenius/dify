from dataclasses import dataclass, field


@dataclass
class AssetItem:
    """A single asset file produced by the build pipeline.

    When *content* is set the payload is available in-process and can be
    written directly into a ZIP or uploaded to a sandbox VM without an
    extra S3 round-trip.  When *content* is ``None`` the caller should
    fetch the bytes from *storage_key* (the traditional presigned-URL
    path).
    """

    asset_id: str
    path: str
    file_name: str
    extension: str
    storage_key: str
    content: bytes | None = field(default=None, repr=False)
