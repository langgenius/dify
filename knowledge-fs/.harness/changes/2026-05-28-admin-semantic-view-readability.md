# Admin Semantic View Readability

## Summary

- Replaced raw KnowledgeFS table rendering in the Admin `Semantic views` panel with purpose-built topic and entity summaries.
- Topic rows now show a readable topic name, topic slug, and collection path.
- Entity rows now show the entity name, type, source node count, and a shortened graph id instead of a full UUID as the main value.
- Low-signal bare numeric metric entries are hidden from the Admin semantic entity table.
- Updated the bootstrap semantic entity extractor so future runs do not turn plain numbers such as `0`, `04`, or `10` into graph metric entities. Metrics still include values with `%`, currency symbols, or units.
- Updated the README Admin Console guide to describe the readable semantic summaries.

## Why

The previous panel showed the low-level virtual filesystem shape directly. That exposed UUIDs, `directory` kinds, and numeric bootstrap entities as primary content, which made the operator view hard to understand.

## Verification

- `pnpm exec biome check --write apps/admin/app/page.tsx apps/admin/app/page.test.tsx packages/api/src/semantic-operator-actions.ts packages/api/src/semantic-operator-actions.test.ts`
- `pnpm --filter @knowledge/admin test -- app/page.test.tsx`
- `pnpm --filter @knowledge/api test -- src/semantic-operator-actions.test.ts src/gateway-document-write.test.ts`
- `pnpm --filter @knowledge/admin typecheck`
- `pnpm --filter @knowledge/api typecheck`
- `git diff --check`
- Browser verification at `http://127.0.0.1:3000/#semantic-views` confirmed the panel now shows `Readable entities` instead of the raw `Entity view` label.

## Risks And Follow-Up

- Existing graph entries that were already extracted as bare numeric metrics may remain in storage until entity extraction is rerun or graph cleanup is applied. The Admin panel suppresses them from the operator view immediately.
- The bootstrap extractor is still intentionally simple; provider-backed extraction should eventually produce richer entity names and types.
