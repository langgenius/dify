# Oracle vector store

The Oracle provider supports Oracle Database 23ai / Oracle AI Database 26ai or
later with `COMPATIBLE` set to at least `23.4.0`, plus Oracle Text. It was
integration-tested against Oracle AI Database 26ai Free Release `23.26.1.0.0`
with `COMPATIBLE=23.6.0`. Configure a dedicated application schema; the
provider does not supply default credentials or a default DSN.

## Oracle Text prerequisite

Each target schema must contain the `WORLD_LEXER` preference before Dify creates
a collection:

```sql
BEGIN
  CTX_DDL.CREATE_PREFERENCE('world_lexer', 'WORLD_LEXER');
END;
/
```

The provider verifies this preference before running collection DDL and creates
Oracle Text indexes with `SYNC (ON COMMIT)` so committed documents are searchable
immediately. Provision the preference as the schema owner during deployment.

## Upgrading existing collections

Collections created by an earlier provider version may have a flexible
`VECTOR(*,*,DENSE)` column or a manually synchronized Oracle Text index. The
provider fails closed when it detects either layout and does not drop or rewrite
the existing table.

Oracle does not support changing a `VECTOR` column's declared dimension in
place. During a maintenance window, back up the dataset and use Dify's dataset
re-index/recreate workflow so the collection is rebuilt with the current
embedding model's fixed `VECTOR(<dimension>, FLOAT32)` column and an
`ON COMMIT` text index. Do not drop an existing collection until its source
documents can be restored and re-indexed.
