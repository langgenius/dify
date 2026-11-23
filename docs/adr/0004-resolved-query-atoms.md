# ADR 0004: Keep resolved suspense-query reads synchronous

Status: Accepted (existing behavior)
Date: 2026-11-23
Owner: `web/utils/query-atoms.ts:atomWithResolvedSuspenseQuery`

## Context

Some derived atoms consume a suspense query after an outer boundary or bootstrap step has already resolved it. Their callers need the resolved query result rather than a result-or-promise union.

## Decision

Expose a synchronous derived atom with the same options and query-client inputs as `atomWithSuspenseQuery`. Throw when the underlying atom still returns a Promise. Do not await the Promise or introduce an async derived atom: that would conceal a violated caller invariant and change the consumer contract. Forward writes to the original query atom.

## Consequences

Callers must establish the resolved-query precondition. An unresolved query is an explicit error rather than an implicit asynchronous transition.
