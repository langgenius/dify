import uuid
from dataclasses import dataclass

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from models.enums import TagType
from models.model import Tag, TagBinding
from services.tag_service import (
    TagBindingCreatePayload,
    TagBindingDeletePayload,
    TagService,
    UpdateTagPayload,
)


@dataclass
class _CurrentUserStub:
    id: str
    current_tenant_id: str
