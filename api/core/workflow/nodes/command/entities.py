from graphon.entities.base_node_data import BaseNodeData


class CommandNodeData(BaseNodeData):
    """
    Command Node Data.
    """

    working_directory: str = ""  # Working directory for command execution
    command: str = ""  # Command to execute
