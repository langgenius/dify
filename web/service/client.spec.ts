import type { MutationFunctionContext } from '@tanstack/react-query'
import type { Tag } from '@/contract/console/tags'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const loadGetBaseURL = async (isClientValue: boolean) => {
  vi.resetModules()
  vi.doMock('@/utils/client', () => ({ isClient: isClientValue, isServer: !isClientValue }))
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  // eslint-disable-next-line next/no-assign-module-variable
  const module = await import('./client')
  warnSpy.mockClear()
  return { getBaseURL: module.getBaseURL, warnSpy }
}

const loadConsoleQuery = async () => {
  vi.resetModules()
  vi.doMock('@/utils/client', () => ({ isClient: true, isServer: false }))
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const module = await import('./client')
  warnSpy.mockRestore()
  return module.consoleQuery
}

const createMutationContext = (queryClient: QueryClient): MutationFunctionContext => ({
  client: queryClient,
  meta: undefined,
})

const createTag = (overrides: Partial<Tag> = {}): Tag => ({
  id: 'tag-1',
  name: 'Frontend',
  type: 'app',
  binding_count: 1,
  ...overrides,
})

// Scenario: base URL selection and warnings.
describe('getBaseURL', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Scenario: client environment uses window origin.
  it('should use window origin when running on the client', async () => {
    // Arrange
    const { origin } = window.location
    const { getBaseURL, warnSpy } = await loadGetBaseURL(true)

    // Act
    const url = getBaseURL('/api')

    // Assert
    expect(url.href).toBe(`${origin}/api`)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  // Scenario: server environment falls back to localhost with warning.
  it('should fall back to localhost and warn on the server', async () => {
    // Arrange
    const { getBaseURL, warnSpy } = await loadGetBaseURL(false)

    // Act
    const url = getBaseURL('/api')

    // Assert
    expect(url.href).toBe('http://localhost/api')
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith('Using localhost as base URL in server environment, please configure accordingly.')
  })

  // Scenario: non-http protocols surface warnings.
  it('should warn when protocol is not http or https', async () => {
    // Arrange
    const { getBaseURL, warnSpy } = await loadGetBaseURL(true)

    // Act
    const url = getBaseURL('localhost:5001/console/api')

    // Assert
    expect(url.protocol).toBe('localhost:')
    expect(url.href).toBe('localhost:5001/console/api')
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(
      'Unexpected protocol for API requests, expected http or https. Current protocol: localhost:. Please configure accordingly.',
    )
  })

  // Scenario: absolute http URLs are preserved.
  it('should keep absolute http URLs intact', async () => {
    // Arrange
    const { getBaseURL, warnSpy } = await loadGetBaseURL(true)

    // Act
    const url = getBaseURL('https://api.example.com/console/api')

    // Assert
    expect(url.href).toBe('https://api.example.com/console/api')
    expect(warnSpy).not.toHaveBeenCalled()
  })
})

// Scenario: oRPC mutation defaults own shared tag cache behavior.
describe('consoleQuery tag mutation defaults', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should add created tags to the matching list query cache', async () => {
    const consoleQuery = await loadConsoleQuery()
    const queryClient = new QueryClient()
    const appListKey = consoleQuery.tags.list.queryKey({
      input: {
        query: {
          type: 'app',
        },
      },
    })
    const knowledgeListKey = consoleQuery.tags.list.queryKey({
      input: {
        query: {
          type: 'knowledge',
        },
      },
    })
    const existingAppTag = createTag({ id: 'tag-1', name: 'Existing' })
    const existingKnowledgeTag = createTag({
      id: 'knowledge-tag-1',
      name: 'Knowledge',
      type: 'knowledge',
    })
    const createdTag = createTag({ id: 'tag-2', name: 'Created' })

    queryClient.setQueryData(appListKey, [existingAppTag])
    queryClient.setQueryData(knowledgeListKey, [existingKnowledgeTag])

    const mutationOptions = consoleQuery.tags.create.mutationOptions()
    await mutationOptions.onSuccess?.(
      createdTag,
      {
        body: {
          name: createdTag.name,
          type: createdTag.type,
        },
      },
      undefined,
      createMutationContext(queryClient),
    )

    expect(queryClient.getQueryData(appListKey)).toEqual([createdTag, existingAppTag])
    expect(queryClient.getQueryData(knowledgeListKey)).toEqual([existingKnowledgeTag])
  })

  it('should update matching tags across cached list queries', async () => {
    const consoleQuery = await loadConsoleQuery()
    const queryClient = new QueryClient()
    const appListKey = consoleQuery.tags.list.queryKey({
      input: {
        query: {
          type: 'app',
        },
      },
    })
    const knowledgeListKey = consoleQuery.tags.list.queryKey({
      input: {
        query: {
          type: 'knowledge',
        },
      },
    })
    const targetTag = createTag({ id: 'tag-1', name: 'Before' })
    const otherTag = createTag({ id: 'tag-2', name: 'Other' })
    const knowledgeTag = createTag({
      id: 'knowledge-tag-1',
      name: 'Knowledge',
      type: 'knowledge',
    })

    queryClient.setQueryData(appListKey, [targetTag, otherTag])
    queryClient.setQueryData(knowledgeListKey, [knowledgeTag])

    const updatedTag = createTag({
      ...targetTag,
      name: 'After',
      binding_count: 5,
    })
    const mutationOptions = consoleQuery.tags.update.mutationOptions()
    await mutationOptions.onSuccess?.(
      updatedTag,
      {
        params: {
          tagId: targetTag.id,
        },
        body: {
          name: 'Ignored Client Name',
        },
      },
      undefined,
      createMutationContext(queryClient),
    )

    expect(queryClient.getQueryData(appListKey)).toEqual([
      updatedTag,
      otherTag,
    ])
    expect(queryClient.getQueryData(knowledgeListKey)).toEqual([knowledgeTag])
  })

  it('should remove deleted tags across cached list queries', async () => {
    const consoleQuery = await loadConsoleQuery()
    const queryClient = new QueryClient()
    const appListKey = consoleQuery.tags.list.queryKey({
      input: {
        query: {
          type: 'app',
        },
      },
    })
    const knowledgeListKey = consoleQuery.tags.list.queryKey({
      input: {
        query: {
          type: 'knowledge',
        },
      },
    })
    const deletedTag = createTag({ id: 'tag-1', name: 'Delete me' })
    const remainingTag = createTag({ id: 'tag-2', name: 'Keep me' })
    const knowledgeTag = createTag({
      id: 'knowledge-tag-1',
      name: 'Knowledge',
      type: 'knowledge',
    })

    queryClient.setQueryData(appListKey, [deletedTag, remainingTag])
    queryClient.setQueryData(knowledgeListKey, [knowledgeTag])

    const mutationOptions = consoleQuery.tags.delete.mutationOptions()
    await mutationOptions.onSuccess?.(
      undefined,
      {
        params: {
          tagId: deletedTag.id,
        },
      },
      undefined,
      createMutationContext(queryClient),
    )

    expect(queryClient.getQueryData(appListKey)).toEqual([remainingTag])
    expect(queryClient.getQueryData(knowledgeListKey)).toEqual([knowledgeTag])
  })
})
