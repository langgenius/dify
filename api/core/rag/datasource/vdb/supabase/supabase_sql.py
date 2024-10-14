"""The tables and related functions defined in Supabase"""

SQL_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS {table_name} (
    id UUID PRIMARY KEY,
    text TEXT NOT NULL,
    meta JSONB NOT NULL,
    embedding vector({dimension}) NOT NULL
) using heap;
"""

FUNC_SQL_OF_EXECUTE_SQL = """
CREATE OR REPLACE FUNCTION execute_sql(sql TEXT)
RETURNS VOID AS $$
BEGIN
    EXECUTE sql;
END;
$$ LANGUAGE plpgsql;
"""

FUNC_SQL_OF_SEARCH_VECTOR = """
CREATE OR REPLACE FUNCTION search_vector(
    table_name TEXT,
    query_vector vector,
    result_limit INTEGER DEFAULT 10
)
RETURNS TABLE(id UUID, text TEXT, meta JSONB, embedding vector, distance FLOAT) AS $$
DECLARE
    sql TEXT;
BEGIN
    sql := format(
        'SELECT id, text, meta, embedding, embedding <=> $1 AS distance FROM %I ORDER BY distance LIMIT $2',
        table_name
    );

    RETURN QUERY EXECUTE sql USING query_vector, result_limit;
END;
$$ LANGUAGE plpgsql;
"""

FUNC_SQL_OF_SEARCH_FULL_TEXT = """
CREATE OR REPLACE FUNCTION search_full_text(
    table_name TEXT,
    query TEXT,
    result_limit INTEGER DEFAULT 10
)
RETURNS TABLE(id UUID, text TEXT, meta JSONB, score DOUBLE PRECISION) AS $$
DECLARE
    sql TEXT;
BEGIN
    sql := format(
        'SELECT id, text, meta, ts_rank(to_tsvector(coalesce(text, '''')), plainto_tsquery(%L))::DOUBLE PRECISION 
        AS score FROM %I
        WHERE to_tsvector(text) @@ plainto_tsquery(%L)
        ORDER BY score DESC
        LIMIT %L',
        query, table_name, query, result_limit
    );

    RETURN QUERY EXECUTE sql;
END;
$$ LANGUAGE plpgsql;
"""
