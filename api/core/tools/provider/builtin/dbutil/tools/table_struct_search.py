import json
from typing import Any, Union

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.provider.builtin.dbutil.tools.use_db_util import useDbUtil
from core.tools.tool.builtin_tool import BuiltinTool


class TableStructUtilTool(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        """
        db_type = tool_parameters.get("db_type", "")
        if not db_type:
            return self.create_text_message("Please select the database type")
        db_connection = tool_parameters.get("db_connection", "")
        if not db_connection:
            return self.create_text_message("Please fill in the database link information, such as：mysql+pymysql://admin:admin@localhost:13306/test")
        query_tbl = tool_parameters.get("query_tbl", "")
        if not query_tbl:
            return self.create_text_message("Please fill in the table name")

        try:
            db = useDbUtil(db_connection)

        except Exception as e:
            return self.create_text_message(
                "Database link creation exception. {}".format(e)
            )

        try:
            db_struct = db.get_create_table(query_tbl)

            if db_struct == None:
                db_struct = []


            return self.create_text_message(
                json.dumps(db_struct, ensure_ascii=False)
            )
        except Exception as e:
            return self.create_text_message(
                "SQL execution exception. {}".format(e)
            )
