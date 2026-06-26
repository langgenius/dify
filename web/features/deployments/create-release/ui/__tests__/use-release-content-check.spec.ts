import type { CreateReleaseSourceSelection } from '../use-release-content-check'
import { describe, expect, it } from 'vitest'
import { canCheckReleaseSourceContent } from '../use-release-content-check'

function releaseSource(overrides: Partial<CreateReleaseSourceSelection> = {}): CreateReleaseSourceSelection {
  return {
    dslContent: '',
    dslReadError: false,
    encodedDslContent: '',
    hasDslContent: false,
    hasUnsupportedDslMode: false,
    isReadingDsl: false,
    isWorkflowDslContent: false,
    releaseSourceMode: 'sourceApp',
    selectedSourceAppId: undefined,
    ...overrides,
  }
}

describe('canCheckReleaseSourceContent', () => {
  it('should allow source app releases when a source app is selected', () => {
    expect(canCheckReleaseSourceContent(releaseSource({
      selectedSourceAppId: 'app-1',
    }))).toBe(true)
  })

  it('should block DSL release content checks when deployment DSL import is disabled', () => {
    expect(canCheckReleaseSourceContent(releaseSource({
      dslContent: 'app:\n  mode: workflow',
      encodedDslContent: 'encoded-dsl',
      hasDslContent: true,
      isWorkflowDslContent: true,
      releaseSourceMode: 'dsl',
    }))).toBe(false)
  })
})
