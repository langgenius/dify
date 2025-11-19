from pydantic import BaseModel

class File(BaseModel):
    def to_dict(self):
        return {}

class FileAttribute(BaseModel):
    pass

class FileTransferMethod(BaseModel):
    pass

class FileType(BaseModel):
    pass
