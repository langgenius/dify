from __future__ import annotations

import io
import os
from pathlib import Path
from typing import Mapping, Sequence

from ._base_type import FileTypes, HttpxFileTypes, HttpxRequestFiles, RequestFiles


def is_file_content(obj: object) -> bool:
    return isinstance(obj, (bytes, tuple, io.IOBase, os.PathLike))


def _transform_file(file: FileTypes) -> HttpxFileTypes:
    if is_file_content(file):
        if isinstance(file, os.PathLike):
            path = Path(file)
            return path.name, path.read_bytes()
        else:
            return file
    if isinstance(file, tuple):
        if isinstance(file[1], os.PathLike):
            return (file[0], Path(file[1]).read_bytes(), *file[2:])
        else:
            return (file[0], file[1], *file[2:])
    else:
        raise TypeError(f"Unexpected input file with type {type(file)},Expected FileContent type or tuple type")


def make_httpx_files(files: RequestFiles | None) -> HttpxRequestFiles | None:
    if files is None:
        return None

    if isinstance(files, Mapping):
        files = {key: _transform_file(file) for key, file in files.items()}
    elif isinstance(files, Sequence):
        files = [(key, _transform_file(file)) for key, file in files]
    else:
        raise TypeError(f"Unexpected input file with type {type(files)}, excepted Mapping or Sequence")
    return files
