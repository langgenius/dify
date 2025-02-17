from flask_restful import fields  # type: ignore

from core.file import File


class FilesContainedField(fields.Raw):
    def format(self, value):
        return self._format_file_object(value)

    def _format_file_object(self, v):
        if isinstance(v, File):
            return v.model_dump()
        if isinstance(v, dict):
            return {k: self._format_file_object(vv) for k, vv in v.items()}
        if isinstance(v, list):
            return [self._format_file_object(vv) for vv in v]
        return v
