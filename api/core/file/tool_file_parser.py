tool_file_manager = {"manager": None}


class ToolFileParser:
    @staticmethod
    def get_tool_file_manager() -> "ToolFileManager":
        return tool_file_manager["manager"]
