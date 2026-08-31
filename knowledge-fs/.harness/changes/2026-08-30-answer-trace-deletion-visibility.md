# Answer trace deletion visibility

## Summary

- Scoped answer-trace space visibility to active knowledge-space deletion jobs instead of treating
  every Source, logical-document, or document-asset deletion as a space-wide read outage.
- Preserved the trace when one cited document is deleted, while projecting only that evidence item
  as a content-free `unavailable` tombstone. Evidence whose current document and permission closure
  remains valid is returned unchanged.
- Applied the same evidence projection to trace detail, evidence, conflict, and missing-evidence
  views so deleted or permission-revoked content cannot leak through embedded trace metadata.
- Reused the same answer-trace visibility predicate in quality trace history so a trace advertised
  by the list endpoint is also eligible for the detail and evidence endpoints.
- Kept list-time admission constant per knowledge space and backed by the existing active-target
  deletion index. Detail-time evidence revalidation performs one bounded node lookup and one
  bounded document lookup instead of issuing one document query per cited item.

## Regression coverage

- PostgreSQL and TiDB SQL coverage verifies that only `target_type = 'knowledge_space'` is a
  trace-wide deletion fence; document-level availability is handled by the item projection.
- Projection and handler coverage verifies mixed available/deleted evidence, permission revocation,
  dangling bundles, and machine-readable tombstones.
- Quality history coverage verifies that durable trace visibility is applied before pagination.
- Repository coverage verifies the bounded bulk document lookup and that trace list SQL reuses its
  existing space/evidence joins without correlated duplicate space scans.
- `@knowledge/api` typecheck and the complete API test suite pass.
