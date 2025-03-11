from enum import Enum

from .common import BlockEnum, CommonNodeType

# Import previously defined CommonNodeType
# Assume it is defined in the same module


class NoteTheme(str, Enum):
    blue = "blue"
    cyan = "cyan"
    green = "green"
    yellow = "yellow"
    pink = "pink"
    violet = "violet"


class NoteNodeType(CommonNodeType):
    """Custom note node type implementation."""

    text: str
    theme: NoteTheme
    author: str
    showAuthor: bool


# Example usage
if __name__ == "__main__":
    example_node = NoteNodeType(
        title="Example Note Node",
        desc="A note node example",
        type=BlockEnum.custom_note,
        text="This is a note.",
        theme=NoteTheme.green,
        author="John Doe",
        showAuthor=True,
    )
    print(example_node)
