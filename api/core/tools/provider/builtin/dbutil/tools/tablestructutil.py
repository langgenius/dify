import json
from typing import Any, Union
import logging

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.provider.builtin.dbutil.tools.use_db import use_db

class TablestructutilTool(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        """
        db_type = tool_parameters.get("db_type", "")
        if not db_type:
            return self.create_text_message("请选择数据库类型")
        db_connection = tool_parameters.get("db_connection", "")
        if not db_connection:
            return self.create_text_message("请填写数据库链接信息，例如：mysql+pymysql://admin:admin@localhost:13306/test")
        query_tbl = tool_parameters.get("query_tbl", "")
        if not query_tbl:
            return self.create_text_message("请填写表名")

        try:
            db = use_db(db_connection, logging)

        except Exception as e:
            return self.create_text_message(
                "创建数据库链接异常. {}".format(e)
            )

        try:
            db_struct = db.get_create_table(query_tbl)
            print(f'Used for query: {db_struct}')

            if db_struct == None:
                db_struct = []


            return self.create_text_message(
                json.dumps(db_struct, ensure_ascii=False)
            )
        except Exception as e:
            return self.create_text_message(
                "执行sql异常. {}".format(e)
            )
