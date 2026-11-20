"""Build small zip archives in memory for tests of code that reads user zips."""

import io
import zipfile
from collections.abc import Collection, Mapping


def zip_bytes(members: Mapping[str, bytes], *, folders: Collection[str] = ()) -> bytes:
    """Postcondition: a deflated zip holding ``folders`` as folder entries, then ``members`` in order."""
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for folder in folders:
            archive.writestr(zipfile.ZipInfo(folder), b"")
        for path, content in members.items():
            archive.writestr(path, content)
    return output.getvalue()
