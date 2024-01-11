from enum import Enum
from typing import Any, Dict


class MinimaxMessage:
    class Role(Enum):
        USER = 'USER'
        ASSISTANT = 'BOT'
        SYSTEM = 'SYSTEM'

    role: str = Role.USER.value
    content: str
    usage: Dict[str, int] = None
    stop_reason: str = ''

    def to_dict(self) -> Dict[str, Any]:
        return {
            'sender_type': self.role,
            'sender_name': '我' if self.role == 'USER' else '专家',
            'text': self.content,
        }
    
    def __init__(self, content: str, role: str = 'USER') -> None:
        self.content = content
        self.role = role