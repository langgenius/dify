import type { DatabaseAdapter, DatabaseQueryValue, DatabaseRow } from "@knowledge/core";
import { runWithAbortSignal } from "./bounded-concurrency";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import { readableDocumentAssetPredicateSql } from "./document-asset-visibility-sql";
import type {
  GraphQueryRepository,
  GraphQueryScope,
  GraphSemanticCandidate,
  GraphSemanticSearchInput,
} from "./graph-query-contracts";
import { GRAPH_RELATION_DEFINITIONS, type GraphRelationType } from "./graph-relation-catalog";
import { GRAPH_SEMANTIC_REPRESENTATION_VERSION } from "./graph-semantic-index";
import { retrievalEnabledDocumentPredicate, retrievalMetadataFilterSql } from "./hybrid-retrieval";
import {
  mapGraphEntityRow,
  mapPublishedGraphEntityRow,
  mapPublishedGraphRelationRow,
  publishedGraphEntitySelectSql,
  publishedGraphRelationSelectSql,
} from "./published-graph-index-repository";
import { normalizeRetrievalMetadataFilters } from "./retrieval-filter-utils";

/** All candidate ranking and every hop operate on the same publication/permission closure. */
export function graphQueryScopeSql(database: DatabaseAdapter, scope: GraphQueryScope) {
  const q = (name: string) => quoteDatabaseIdentifier(database, name);
  const params: DatabaseQueryValue[] = [];
  const bind = (value: DatabaseQueryValue) => databasePlaceholder(database, params.push(value));
  const snapshot = scope.snapshot;
  if (
    !snapshot.tenantId ||
    !snapshot.knowledgeSpaceId ||
    !snapshot.publicationId ||
    !snapshot.fingerprint
  ) {
    throw new Error("Graph query requires an immutable tenant-scoped publication");
  }
  const scopeWhere = `pub.${q("tenant_id")} = ${bind(snapshot.tenantId)} AND pub.${q("knowledge_space_id")} = ${bind(snapshot.knowledgeSpaceId)} AND pub.${q("id")} = ${bind(snapshot.publicationId)} AND pub.${q("fingerprint")} = ${bind(snapshot.fingerprint)} AND pub.${q("status")} IN ('published', 'superseded')`;
  const acl = (alias: string) => {
    const value = bind(JSON.stringify([...new Set(scope.permissionScope)]));
    const permissions =
      alias === "d"
        ? database.dialect === "postgres"
          ? `COALESCE(d.${q("metadata")} -> 'permissionScope', '[]'::jsonb)`
          : `COALESCE(JSON_EXTRACT(d.${q("metadata")}, '$.permissionScope'), JSON_ARRAY())`
        : `${alias}.${q("permission_scope")}`;
    return database.dialect === "postgres"
      ? `${value}::jsonb @> ${permissions}`
      : `JSON_CONTAINS(CAST(${value} AS JSON), ${permissions})`;
  };
  const nodePermission = `${acl("n")} AND ${acl("d")}`;
  const filters = retrievalMetadataFilterSql(
    database,
    "p",
    "n",
    "d",
    normalizeRetrievalMetadataFilters(scope.filters),
    params,
  );
  const nodeContains = (alias: string) =>
    database.dialect === "postgres"
      ? `${alias}.${q("source_node_ids")} ? CAST(an.${q("id")} AS text)`
      : `JSON_CONTAINS(${alias}.${q("source_node_ids")}, JSON_QUOTE(CAST(an.${q("id")} AS CHAR)))`;
  const closure = (alias: string) => {
    const length =
      database.dialect === "postgres"
        ? `jsonb_array_length(${alias}.${q("source_node_ids")})`
        : `JSON_LENGTH(${alias}.${q("source_node_ids")})`;
    return `${length} > 0 AND (SELECT COUNT(*) FROM authorized_nodes an WHERE an.${q("knowledge_space_id")} = ${alias}.${q("knowledge_space_id")} AND an.${q("publication_generation_id")} = ${alias}.${q("publication_generation_id")} AND ${nodeContains(alias)}) = ${length}`;
  };
  const entityPermission = acl("e");
  const relationPermission = acl("r");
  const sql = `WITH published_scope AS (
    SELECT pub.* FROM ${q("projection_set_publications")} pub
    JOIN ${q("knowledge_spaces")} ks ON ks.${q("id")} = pub.${q("knowledge_space_id")} AND ks.${q("tenant_id")} = pub.${q("tenant_id")}
    WHERE ${scopeWhere} AND ks.${q("lifecycle_state")} = 'active' AND ks.${q("deletion_job_id")} IS NULL
  ), visible_generations AS (
    SELECT DISTINCT m.${q("knowledge_space_id")}, m.${q("generation_id")} FROM published_scope pub
    JOIN ${q("projection_set_publication_members")} m ON m.${q("publication_id")} = pub.${q("id")} AND m.${q("tenant_id")} = pub.${q("tenant_id")} AND m.${q("knowledge_space_id")} = pub.${q("knowledge_space_id")}
    WHERE m.${q("component_type")} = 'document-outline' AND m.${q("document_asset_id")} IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM ${q("document_semantic_enrichment_jobs")} j WHERE j.${q("tenant_id")} = pub.${q("tenant_id")} AND j.${q("knowledge_space_id")} = m.${q("knowledge_space_id")} AND j.${q("document_asset_id")} = m.${q("document_asset_id")} AND j.${q("publication_generation_id")} = m.${q("generation_id")} AND j.${q("run_state")} <> 'succeeded')
  ), authorized_nodes AS (
    SELECT DISTINCT n.${q("id")}, n.${q("knowledge_space_id")}, n.${q("publication_generation_id")} FROM published_scope pub
    JOIN ${q("projection_set_publication_members")} m ON m.${q("publication_id")} = pub.${q("id")} AND m.${q("tenant_id")} = pub.${q("tenant_id")} AND m.${q("knowledge_space_id")} = pub.${q("knowledge_space_id")} AND m.${q("component_type")} = 'index-projection'
    JOIN ${q("index_projections")} p ON p.${q("id")} = m.${q("component_key")} AND p.${q("knowledge_space_id")} = m.${q("knowledge_space_id")} AND p.${q("publication_generation_id")} = m.${q("generation_id")} AND p.${q("status")} = 'ready'
    JOIN ${q("knowledge_nodes")} n ON n.${q("id")} = p.${q("node_id")} AND n.${q("knowledge_space_id")} = p.${q("knowledge_space_id")} AND n.${q("publication_generation_id")} = p.${q("publication_generation_id")} AND n.${q("document_asset_id")} = m.${q("document_asset_id")}
    JOIN ${q("document_assets")} d ON d.${q("id")} = n.${q("document_asset_id")} AND d.${q("knowledge_space_id")} = n.${q("knowledge_space_id")}
    WHERE ${nodePermission} AND d.${q("parser_status")} = 'parsed' AND ${readableDocumentAssetPredicateSql(database, "d", "graph_parent_source")} AND ${retrievalEnabledDocumentPredicate(database, "n")}${filters}
  ), visible_entities AS (
    SELECT e.* FROM ${q("graph_entities")} e JOIN visible_generations g ON g.${q("knowledge_space_id")} = e.${q("knowledge_space_id")} AND g.${q("generation_id")} = e.${q("publication_generation_id")}
    WHERE ${entityPermission} AND ${closure("e")}
  ), visible_relations AS (
    SELECT r.* FROM ${q("graph_relations")} r
    JOIN visible_entities subject ON subject.${q("id")} = r.${q("subject_entity_id")} AND subject.${q("knowledge_space_id")} = r.${q("knowledge_space_id")} AND subject.${q("publication_generation_id")} = r.${q("publication_generation_id")}
    JOIN visible_entities object ON object.${q("id")} = r.${q("object_entity_id")} AND object.${q("knowledge_space_id")} = r.${q("knowledge_space_id")} AND object.${q("publication_generation_id")} = r.${q("publication_generation_id")}
    WHERE ${relationPermission} AND ${closure("r")}
  )`;
  return { sql, params, bind, q };
}

export function createDatabaseGraphQueryRepository(
  database: DatabaseAdapter,
): GraphQueryRepository {
  const execute = (
    scope: GraphQueryScope,
    sql: string,
    params: DatabaseQueryValue[],
    maxRows: number,
  ) =>
    runWithAbortSignal(async () => {
      // Abort stops the caller immediately; the database deadline also stops abandoned SQL work.
      if (database.dialect === "postgres")
        return database.transaction(async (transaction) => {
          scope.signal?.throwIfAborted();
          await transaction.execute({
            operation: "schema",
            tableName: "graph_entities",
            maxRows: 0,
            params: [],
            sql: "SET LOCAL statement_timeout = '5000ms';",
          });
          scope.signal?.throwIfAborted();
          return transaction.execute({
            operation: "select",
            tableName: "graph_entities",
            sql,
            params,
            maxRows,
          });
        });
      scope.signal?.throwIfAborted();
      return database.execute({
        operation: "select",
        tableName: "graph_entities",
        sql: sql.replaceAll("SELECT ", "SELECT /*+ MAX_EXECUTION_TIME(5000) */ "),
        params,
        maxRows,
      });
    }, scope.signal);
  return {
    search: async (input) => {
      if (
        !Number.isSafeInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > 32 ||
        !input.query.trim() ||
        input.query.length > 8000
      )
        throw new Error("Invalid graph semantic search bounds");
      if (
        !input.vectorSpaceId ||
        !input.queryVector.length ||
        input.queryVector.length > 16384 ||
        !input.queryVector.every(Number.isFinite) ||
        !input.queryVector.some((value) => value !== 0)
      )
        throw new Error("Invalid graph query vector");
      const search = async (kind: "entity" | "relation") => {
        const built = graphQueryScopeSql(database, input);
        const { bind, q } = built;
        const table = kind === "entity" ? "visible_entities" : "visible_relations";
        const projectionTable =
          kind === "entity"
            ? "graph_entity_semantic_projections"
            : "graph_relation_semantic_projections";
        const name = kind === "entity" ? `f.${q("name")}` : `f.${q("type")}`;
        const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
        // Legacy graphs remain lexically discoverable without doing query-time embedding writes.
        const fallback =
          kind === "entity"
            ? `CONCAT(${name}, ' ', CAST(f.${q("aliases")} AS ${database.dialect === "postgres" ? "text" : "CHAR"}))`
            : `CASE f.${q("type")} ${Object.entries(GRAPH_RELATION_DEFINITIONS)
                .map(
                  ([type, description]) =>
                    `WHEN ${literal(type)} THEN ${literal(`${type} ${description}`)}`,
                )
                .join(" ")} ELSE ${name} END`;
        const join = `LEFT JOIN ${q(projectionTable)} s ON s.${q("owner_id")} = f.${q("id")} AND s.${q("knowledge_space_id")} = f.${q("knowledge_space_id")} AND s.${q("publication_generation_id")} = f.${q("publication_generation_id")} AND s.${q("vector_space_id")} = ${bind(input.vectorSpaceId)} AND s.${q("dimension")} = ${bind(input.queryVector.length)} AND s.${q("representation_version")} = ${bind(GRAPH_SEMANTIC_REPRESENTATION_VERSION)}`;
        const query = bind(input.query.toLowerCase());
        const position =
          database.dialect === "postgres"
            ? `POSITION(LOWER(${name}) IN f.query_text)`
            : `LOCATE(LOWER(${name}), f.query_text)`;
        let exact = `(LENGTH(${name}) >= 2 AND ${position} > 0)`;
        if (kind === "entity" && database.dialect === "postgres")
          exact = `(${exact} OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(f.${q("aliases")}) alias(value) WHERE LENGTH(alias.value) >= 2 AND POSITION(LOWER(alias.value) IN f.query_text) > 0))`;
        const lexical =
          graphLexicalTerms(input.query)
            .map(
              (term) =>
                `(CASE WHEN LOWER(f.semantic_text) LIKE ${bind(`%${term.replace(/[\\%_]/g, "\\$&")}%`)} ESCAPE ${database.dialect === "postgres" ? "E'\\\\'" : "'\\\\'"} THEN 1.0 ELSE 0.0 END)`,
            )
            .join(" + ") || "0.0";
        const vector = bind(JSON.stringify(input.queryVector));
        const distance =
          database.dialect === "postgres"
            ? `1 - (f.stored_vector <=> ${vector}::vector)`
            : `1 - VEC_COSINE_DISTANCE(f.stored_vector, CAST(${vector} AS VECTOR))`;
        const dimensions =
          database.dialect === "postgres"
            ? `vector_dims(s.${q("vector")})`
            : `VEC_DIMS(s.${q("vector")})`;
        // Predicates share a versioned representation. Evaluate each visible predicate once,
        // not one cosine distance per edge; coverage still counts every authorized fact.
        const candidateFacts =
          kind === "entity"
            ? "SELECT * FROM facts"
            : `SELECT * FROM (SELECT facts.*, ROW_NUMBER() OVER (PARTITION BY ${q("type")} ORDER BY vector_ready DESC, ${q("id")} ASC) AS predicate_rank FROM facts) ranked_predicates WHERE predicate_rank = 1`;
        const scores = `SELECT f.*, CASE WHEN ${exact} THEN 1.0 ELSE 0.0 END AS exact_score, ${lexical} AS lexical_score, CASE WHEN f.vector_ready = 1 THEN ${distance} ELSE 0.0 END AS vector_score FROM candidate_facts f`;
        const legs = ["exact", "lexical", "vector"] as const;
        const sql = `${built.sql}, joined_facts AS (
          SELECT f.*, COALESCE(s.${q("search_text")}, ${fallback}) AS semantic_text, s.${q("vector")} AS stored_vector, CASE WHEN ${dimensions} = s.${q("dimension")} THEN 1 ELSE 0 END AS vector_ready FROM ${table} f ${join}
        ), facts AS (SELECT joined_facts.*, CAST(${query} AS ${database.dialect === "postgres" ? "text" : "CHAR"}) AS query_text FROM joined_facts), candidate_facts AS (${candidateFacts}), scored AS (${scores}), legs AS (
          ${legs.map((leg) => `SELECT ${q("id")}, ${kind === "entity" ? q("name") : q("type")} AS name, ${q("type")}, semantic_text, ${leg}_score AS semantic_score, '${leg}' AS leg FROM scored WHERE ${leg}_score > 0`).join(" UNION ALL ")}
        ), deduped AS (SELECT legs.*, ROW_NUMBER() OVER (PARTITION BY leg, ${q(kind === "entity" ? "id" : "type")} ORDER BY semantic_score DESC, ${q("id")} ASC) AS kind_rank FROM legs), ranked AS (
          SELECT deduped.*, ROW_NUMBER() OVER (PARTITION BY leg ORDER BY semantic_score DESC, ${q("id")} ASC) AS leg_rank FROM deduped WHERE kind_rank = 1
        ), limited AS (SELECT * FROM ranked WHERE leg_rank <= ${bind(input.limit * 3)}), coverage AS (SELECT COUNT(*) AS total, COALESCE(SUM(vector_ready), 0) AS indexed FROM facts)
        SELECT limited.*, coverage.total, coverage.indexed FROM coverage LEFT JOIN limited ON 1 = 1 ORDER BY leg, leg_rank;`;
        const result = await execute(input, sql, built.params, input.limit * 9 + 1);
        return {
          candidates: fuseGraphCandidates(
            legs.map((leg) => ({ leg, rows: result.rows.filter((row) => row.leg === leg) })),
            kind,
            input.limit,
          ),
          total: Number(result.rows[0]?.total ?? 0),
          indexed: Number(result.rows[0]?.indexed ?? 0),
        };
      };
      const [entities, relations] = await Promise.all([search("entity"), search("relation")]);
      const total = entities.total + relations.total;
      const indexed = entities.indexed + relations.indexed;
      return {
        entities: entities.candidates,
        relations: relations.candidates,
        semanticCoverage: indexed === total ? "complete" : indexed === 0 ? "missing" : "partial",
      };
    },
    loadEntities: async (input) => {
      if (!input.ids.length) return [];
      if (input.ids.length > 128) throw new Error("Graph entity batch exceeds 128");
      const built = graphQueryScopeSql(database, input);
      const result = await execute(
        input,
        `${built.sql} SELECT * FROM visible_entities WHERE ${built.q("id")} IN (${input.ids.map(built.bind).join(", ")});`,
        built.params,
        input.ids.length,
      );
      return result.rows.map(mapGraphEntityRow);
    },
    loadEdges: async (input) => {
      if (!input.frontier.length) return { edges: [], truncated: false };
      if (
        input.frontier.length > 128 ||
        !Number.isSafeInteger(input.fanout) ||
        input.fanout < 1 ||
        input.fanout > 64
      )
        throw new Error("Invalid graph frontier bounds");
      const directions =
        input.step.direction === "either"
          ? (["outgoing", "incoming"] as const)
          : [input.step.direction];
      const pages = await Promise.all(
        directions.map(async (direction) => {
          const built = graphQueryScopeSql(database, input);
          const { q, bind } = built;
          const from = direction === "outgoing" ? "subject_entity_id" : "object_entity_id";
          const to = direction === "outgoing" ? "object_entity_id" : "subject_entity_id";
          const roots = input.frontier.map(bind).join(", ");
          const types = input.step.relationTypes.map(bind).join(", ");
          const limit = bind(input.fanout + 1);
          const result = await execute(
            input,
            `${built.sql}, ranked_edges AS (SELECT ${publishedGraphRelationSelectSql(database, "r")}, ${publishedGraphEntitySelectSql(database, "e")}, r.${q(from)} AS from_entity_id, r.${q(to)} AS to_entity_id, ROW_NUMBER() OVER (PARTITION BY r.${q(from)} ORDER BY r.${q("confidence")} DESC, r.${q("id")} ASC) AS edge_rank FROM visible_relations r JOIN visible_entities e ON e.${q("id")} = r.${q(to)} WHERE r.${q(from)} IN (${roots}) AND r.${q("type")} IN (${types})) SELECT * FROM ranked_edges WHERE edge_rank <= ${limit} ORDER BY from_entity_id, edge_rank;`,
            built.params,
            input.frontier.length * (input.fanout + 1),
          );
          return result.rows;
        }),
      );
      const rows = pages.flat();
      return {
        edges: rows
          .filter((row) => Number(row.edge_rank) <= input.fanout)
          .map((row) => ({
            entity: mapPublishedGraphEntityRow(row),
            edge: {
              fromEntityId: String(row.from_entity_id),
              toEntityId: String(row.to_entity_id),
              relation: mapPublishedGraphRelationRow(row),
            },
          })),
        truncated: rows.some((row) => Number(row.edge_rank) > input.fanout),
      };
    },
  };
}

export function graphLexicalTerms(query: string): string[] {
  const normalized = query.normalize("NFKC").toLocaleLowerCase();
  const words = normalized.match(/[\p{L}\p{N}_]+/gu) ?? [];
  return [
    ...new Set(
      words
        .flatMap((word) =>
          /\p{Script=Han}/u.test(word)
            ? [
                word,
                ...Array.from(word)
                  .slice(0, 32)
                  .flatMap((_, index, chars) =>
                    index + 1 < chars.length ? [chars.slice(index, index + 2).join("")] : [],
                  ),
              ]
            : [word],
        )
        .filter((word) => word.length > 1),
    ),
  ].slice(0, 24);
}

function fuseGraphCandidates(
  lists: readonly {
    readonly leg: "exact" | "lexical" | "vector";
    readonly rows: readonly DatabaseRow[];
  }[],
  kind: "entity" | "relation",
  limit: number,
): GraphSemanticCandidate[] {
  const candidates = new Map<string, GraphSemanticCandidate>();
  for (const list of lists) {
    const seen = new Set<string>();
    for (const [index, row] of list.rows.entries()) {
      const id = kind === "entity" ? String(row.id) : String(row.type);
      if (seen.has(id)) continue;
      seen.add(id);
      if (kind === "relation" && !Object.hasOwn(GRAPH_RELATION_DEFINITIONS, id)) continue;
      const previous = candidates.get(id);
      candidates.set(id, {
        id,
        name: String(row.name),
        type: String(row.type),
        description:
          kind === "relation"
            ? GRAPH_RELATION_DEFINITIONS[id as GraphRelationType]
            : String(row.semantic_text).slice(0, 1200),
        score: (previous?.score ?? 0) + (list.leg === "exact" ? 3 : 1) / (60 + index + 1),
        matchedBy: [...new Set([...(previous?.matchedBy ?? []), list.leg])],
      });
    }
  }
  return [...candidates.values()]
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit);
}
