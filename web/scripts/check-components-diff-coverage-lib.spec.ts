import { describe, expect, it, vi } from 'vitest'
import { parseChangedLineMap, resolveGitDiffContext } from './check-components-diff-coverage-lib.mjs'

function createExecGitMock(responses: Record<string, string | Error>) {
  return vi.fn((args: string[]) => {
    const key = args.join(' ')
    const response = responses[key]

    if (response instanceof Error)
      throw response

    if (response === undefined)
      throw new Error(`Unexpected git args: ${key}`)

    return response
  })
}

describe('resolveGitDiffContext', () => {
  it('switches exact diff to combined merge diff when head merges origin/main into the branch', () => {
    const execGit = createExecGitMock({
      'rev-parse --verify feature-parent-sha': 'feature-parent-sha\n',
      'rev-parse --verify merge-sha': 'merge-sha\n',
      'rev-list --parents -n 1 merge-sha': 'merge-sha feature-parent-sha main-parent-sha\n',
      'symbolic-ref --quiet --short refs/remotes/origin/HEAD': 'origin/main\n',
      'merge-base --is-ancestor main-parent-sha origin/main': '',
    })

    expect(resolveGitDiffContext({
      base: 'feature-parent-sha',
      head: 'merge-sha',
      mode: 'exact',
      execGit,
    })).toEqual({
      base: 'feature-parent-sha',
      head: 'merge-sha',
      mode: 'exact',
      requestedMode: 'exact',
      reason: 'ignored merge from origin/main',
      useCombinedMergeDiff: true,
    })
  })

  it('falls back to origin/main when origin/HEAD is unavailable', () => {
    const execGit = createExecGitMock({
      'rev-parse --verify feature-parent-sha': 'feature-parent-sha\n',
      'rev-parse --verify merge-sha': 'merge-sha\n',
      'rev-list --parents -n 1 merge-sha': 'merge-sha feature-parent-sha main-parent-sha\n',
      'symbolic-ref --quiet --short refs/remotes/origin/HEAD': new Error('missing origin/HEAD'),
      'rev-parse --verify -q origin/main': 'main-tip-sha\n',
      'merge-base --is-ancestor main-parent-sha origin/main': '',
    })

    expect(resolveGitDiffContext({
      base: 'feature-parent-sha',
      head: 'merge-sha',
      mode: 'exact',
      execGit,
    })).toEqual({
      base: 'feature-parent-sha',
      head: 'merge-sha',
      mode: 'exact',
      requestedMode: 'exact',
      reason: 'ignored merge from origin/main',
      useCombinedMergeDiff: true,
    })
  })

  it('keeps exact diff when the second parent is not the default branch', () => {
    const execGit = createExecGitMock({
      'rev-parse --verify feature-parent-sha': 'feature-parent-sha\n',
      'rev-parse --verify merge-sha': 'merge-sha\n',
      'rev-list --parents -n 1 merge-sha': 'merge-sha feature-parent-sha topic-parent-sha\n',
      'symbolic-ref --quiet --short refs/remotes/origin/HEAD': 'origin/main\n',
      'merge-base --is-ancestor topic-parent-sha origin/main': new Error('not ancestor'),
    })

    expect(resolveGitDiffContext({
      base: 'feature-parent-sha',
      head: 'merge-sha',
      mode: 'exact',
      execGit,
    })).toEqual({
      base: 'feature-parent-sha',
      head: 'merge-sha',
      mode: 'exact',
      requestedMode: 'exact',
      reason: null,
      useCombinedMergeDiff: false,
    })
  })
})

describe('parseChangedLineMap', () => {
  it('parses regular diff hunks', () => {
    const diff = [
      'diff --git a/web/app/components/example.tsx b/web/app/components/example.tsx',
      '+++ b/web/app/components/example.tsx',
      '@@ -10,0 +11,2 @@',
    ].join('\n')

    const changedLineMap = parseChangedLineMap(diff, () => true)

    expect([...changedLineMap.get('web/app/components/example.tsx') ?? []]).toEqual([11, 12])
  })

  it('parses combined merge diff hunks', () => {
    const diff = [
      'diff --cc web/app/components/example.tsx',
      '+++ b/web/app/components/example.tsx',
      '@@@ -10,0 -10,0 +11,3 @@@',
    ].join('\n')

    const changedLineMap = parseChangedLineMap(diff, () => true)

    expect([...changedLineMap.get('web/app/components/example.tsx') ?? []]).toEqual([11, 12, 13])
  })
})
