import { STORAGE_KEYS } from '@/config/storage-keys'
import {
  buildContextGenStorageKey,
  clearContextGenStorage,
  CONTEXT_GEN_STORAGE_SUFFIX,
  getContextGenStorageKey,
  getContextGenStorageKeys,
} from '../storage'

describe('context generate storage helpers', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('should build a fallback storage key when flow id is missing', () => {
    expect(buildContextGenStorageKey(undefined, 'tool-node', 'query')).toBe('unknown-tool-node-query')
  })

  it('should include the session prefix and suffix in generated keys', () => {
    const storageKey = 'flow-1-tool-node-query'

    expect(getContextGenStorageKey(storageKey, CONTEXT_GEN_STORAGE_SUFFIX.messages)).toBe(
      `${STORAGE_KEYS.SESSION.CONTEXT_GENERATE.PREFIX}${storageKey}-messages`,
    )
  })

  it('should return all managed keys in a stable order', () => {
    const storageKey = 'flow-1-tool-node-query'

    expect(getContextGenStorageKeys(storageKey)).toEqual([
      getContextGenStorageKey(storageKey, CONTEXT_GEN_STORAGE_SUFFIX.versions),
      getContextGenStorageKey(storageKey, CONTEXT_GEN_STORAGE_SUFFIX.versionIndex),
      getContextGenStorageKey(storageKey, CONTEXT_GEN_STORAGE_SUFFIX.messages),
      getContextGenStorageKey(storageKey, CONTEXT_GEN_STORAGE_SUFFIX.suggestedQuestions),
      getContextGenStorageKey(storageKey, CONTEXT_GEN_STORAGE_SUFFIX.suggestedQuestionsFetched),
    ])
  })

  it('should clear every managed key and ignore remove errors', () => {
    const storageKey = 'flow-1-tool-node-query'
    const removeItemSpy = vi.spyOn(Object.getPrototypeOf(window.sessionStorage) as Storage, 'removeItem')
      .mockImplementationOnce(() => {
        throw new Error('private browsing')
      })

    expect(() => clearContextGenStorage(storageKey)).not.toThrow()
    expect(removeItemSpy).toHaveBeenCalledTimes(5)
  })
})
