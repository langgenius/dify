import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

// The invalidation fallback waits while a mutation of the same domain is pending, so a refetch
// cannot land on its optimistic value. It recognises a mutation by its oRPC `mutationKey`;
// generated `mutationOptions()` carry one, a hand-written `useMutation({ ... })` must set it.
const webRoot = path.resolve(__dirname, '../../..')
const sourceDirs = ['app', 'features', 'hooks', 'service', 'context']

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory())
      return entry.name === 'node_modules' || entry.name === '__tests__' ? [] : sourceFiles(full)
    return /\.tsx?$/.test(entry.name) && !/\.(?:spec|test|stories)\.tsx?$/.test(entry.name)
      ? [full]
      : []
  })
}

// The `{ ... }` argument of each `useMutation({` call.
function mutationLiterals(source: string) {
  const literals: string[] = []
  let index = source.indexOf('useMutation({')
  while (index !== -1) {
    const start = index + 'useMutation('.length
    let depth = 0
    let end = start
    for (; end < source.length; end++) {
      if (source[end] === '{') depth++
      else if (source[end] === '}' && --depth === 0) break
    }
    literals.push(source.slice(start, end + 1))
    index = source.indexOf('useMutation({', end)
  }
  return literals
}

const writesOptimistically = (literal: string) =>
  literal.includes('onMutate') && /setQueriesData|setQueryData|writeOptimistically/.test(literal)

describe('optimistic mutations', () => {
  it('give every hand-written optimistic mutation a mutation key', () => {
    const keyless = sourceDirs
      .flatMap((dir) => sourceFiles(path.join(webRoot, dir)))
      .flatMap((file) =>
        mutationLiterals(readFileSync(file, 'utf8'))
          .filter((literal) => writesOptimistically(literal) && !literal.includes('mutationKey'))
          .map(() => path.relative(webRoot, file)),
      )

    // Set `mutationKey: consoleQuery.<procedure>.mutationKey()`, or use `mutationOptions()`.
    expect(keyless).toEqual([])
  })
})
