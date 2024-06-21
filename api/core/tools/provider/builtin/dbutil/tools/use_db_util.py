from sqlalchemy import create_engine, text
import pandas as pd

class useDbUtil():
    def __init__(self, connection_string: str) -> None:
        self.connection_string = connection_string
        self.engine = create_engine(self.connection_string, pool_size=100,pool_recycle=36)

    def run_query(self, query_string: str):
        '''
        Run SQL Qurey
        '''
        result = None
        if query_string == '':
            return None
        try:
            query_string = query_string.replace('%', '%%')
            df = pd.read_sql_query(query_string, self.engine, parse_dates="%Y-%m-%d %H:%M:%S")
            df = df.fillna('')

            if len(df) <= 0:
                return []
            else:
                result = df.to_dict(orient="records")
        except Exception as e:
            self.logger.info(e.args)
            return None

        return result

    def get_structure(self, table):
        '''
        Get a table structure, return in string
        parma: table: table name
        '''
        fields = self.get_fields(table)
        result = ''
        for f in fields:
            result += f[0] + ': ' + f[1]+','

        return result

    def get_structure_type(self, table):
        '''
        Get a table structure with its col types, return in string
        parma: table: table name
        '''
        fields = self.get_fields(table)
        result = ''
        for f in fields:
            result += f[0] + 'COMMENT: ' + f[1]+', TYPE:'+f[2]

        return result

    def get_structure_colzhnames(self, table):
        '''
        Get a table structure with its col comment, return in string
        parma: table: table name
        '''
        fields = self.get_fields(table)
        result = ''
        for f in fields:
            result += f[1]+', '

        return result

    def get_database_list(self):
        '''
        Only use this function to get the root databases.
        '''
        cursor = self.engine.connect().execute(text("show databases;"))
        results = cursor.fetchall()
        return [
            d[0]
            for d in results
            if d[0] not in ["information_schema", "performance_schema", "sys", "mysql"]
        ]

    def get_fields(self, table_name):
        """Get column fields about specified table."""
        cursor = self.engine.connect().execute(
            text(
                f"SELECT COLUMN_NAME, COLUMN_COMMENT,DATA_TYPE  from information_schema.COLUMNS where table_name='{table_name}'".format(
                    table_name
                )
            )
        )
        fields = cursor.fetchall()
        return [[field[0], field[1], field[2]] for field in fields]

    def get_table_comments(self, db_name):
        """get table's comment"""
        cursor = self.engine.connect().execute(
            text(
                f"""SELECT table_name, table_comment FROM information_schema.tables   WHERE table_schema = '{db_name}'""".format(
                    db_name
                )
            )
        )
        table_comments = cursor.fetchall()
        names = []
        comments = []
        for table_comment in table_comments:
            names.append(table_comment[0])
            comments.append(table_comment[1])

        return names, comments

    def get_create_table(self, table_name):
        """get table schema"""
        cursor = self.engine.connect().execute(
            text(
                f"""SHOW CREATE TABLE {table_name}""".format(
                    table_name
                )
            )
        )

        query = cursor.fetchall()
        result = ''
        for q in query[0]:
            result += q

        result = result.replace(f"'{table_name}', ", "")
        result = result.replace('\n', '')

        return result

    def get_columns_dict(self, table_name) -> dict:
        """get table in clumns,return a dict"""
        cursor = self.engine.connect().execute(
            text(
                f"SELECT COLUMN_NAME, COLUMN_COMMENT  from information_schema.COLUMNS where table_name='{table_name}'".format(
                    table_name
                )
            )
        )
        fields = cursor.fetchall()
        dic: dict = {}
        for field in fields:
            dic[field[0]]=str(field[1])
        return dic
