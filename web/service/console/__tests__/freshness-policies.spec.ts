import { describe, expect, it } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import { mergePolicies } from '../policies/merge'

describe('mergePolicies', () => {
  it('merges options of one procedure set by different trees', () => {
    const onSuccess = () => undefined
    expect(
      mergePolicies<Record<string, unknown>>(
        {
          a: { get: { queryOptions: { retry: false } } },
          b: { post: { mutationOptions: { onSuccess } } },
        },
        { a: { get: { queryOptions: { staleTime: 0 } } } },
      ),
    ).toEqual({
      a: { get: { queryOptions: { retry: false, staleTime: 0 } } },
      b: { post: { mutationOptions: { onSuccess } } },
    })
  })

  it('throws when two trees set the same option', () => {
    expect(() =>
      mergePolicies<Record<string, unknown>>(
        { a: { get: { queryOptions: { staleTime: 0 } } } },
        { a: { get: { queryOptions: { staleTime: 1 } } } },
      ),
    ).toThrow('a.get.queryOptions.staleTime')
  })
})

describe('freshness policies', () => {
  it('revalidates a saved token whenever its form opens', () => {
    const options = consoleQuery.account.personalAccessTokens.byTokenId.get.queryOptions({
      input: { params: { token_id: 'token-1' } },
    })
    expect(options).toMatchObject({ staleTime: 0 })
  })

  it('drops credential forms from the cache once they close', () => {
    const options =
      consoleQuery.workspaces.current.modelProviders.byProvider.credentials.get.queryOptions({
        input: { params: { provider: 'openai' }, query: {} },
      })
    expect(options).toMatchObject({ staleTime: 0, gcTime: 0 })
  })

  it('lets a call site override the shared freshness', () => {
    const options = consoleQuery.account.personalAccessTokens.byTokenId.get.queryOptions({
      input: { params: { token_id: 'token-1' } },
      staleTime: 1000,
    })
    expect(options.staleTime).toBe(1000)
  })
})
