import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

// A policy that writes into the cache first cancels running reads of those keys: the
// invalidation fallback refetches observed queries, and a read that started before the write
// would otherwise land over it (README "Cache updates after writes").
const consoleDir = path.resolve(__dirname, '..')
const files = [
  ...readdirSync(path.join(consoleDir, 'policies')).map((name) => path.join('policies', name)),
  'workflow-version-cache.ts',
].filter((file) => file.endsWith('.ts'))

// Where the callback or helper holding a write starts.
const callbackStart =
  /(?:onSuccess|onSettled|onMutate|onError)\s*:|^\s*(?:export\s+)?(?:async\s+)?function\s/

describe('policy cache writes', () => {
  it('cancel running reads of the keys they write first', () => {
    const bare = files.flatMap((file) => {
      const lines = readFileSync(path.join(consoleDir, file), 'utf8').split('\n')
      return lines.flatMap((line, index) => {
        if (!/\.setQuer(?:y|ies)Data\b/.test(line)) return []
        let start = index
        while (start > 0 && !callbackStart.test(lines[start]!)) start--
        const body = lines.slice(start, index + 1).join('\n')
        // A helper whose callers cancel first says so.
        return /cancelQueries|Callers cancel/.test(body) ? [] : [`${file}:${index + 1}`]
      })
    })

    // Add `if (client.isFetching(filters)) await client.cancelQueries(filters)` before the write.
    expect(bare).toEqual([])
  })
})
