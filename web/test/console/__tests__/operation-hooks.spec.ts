import { consoleQuery } from '@/service/console'
import {
  consoleOperationKey,
  consoleQueryKey,
  getOperationInput,
  getOperationPath,
} from '../operation-hooks'

describe('console operation keys', () => {
  it('builds the keys the real console query utilities produce', () => {
    const input = { params: { app_id: 'app-1' } }

    expect(consoleQueryKey('account.profile.get')).toEqual(
      consoleQuery.account.profile.get.queryKey(),
    )
    expect(consoleQueryKey('apps.byAppId.get', input)).toEqual(
      consoleQuery.apps.byAppId.get.queryKey({ input }),
    )
    expect(consoleOperationKey('apps.byAppId.get')).toEqual(consoleQuery.apps.byAppId.get.key())
    expect(consoleOperationKey('apps.byAppId.server.refresh.post', { type: 'mutation' })).toEqual(
      consoleQuery.apps.byAppId.server.refresh.post.mutationOptions().mutationKey,
    )
  })

  it('reads the operation path and input back from a real key', () => {
    const input = { params: { app_id: 'app-1' } }
    const queryKey = consoleQuery.apps.byAppId.get.queryKey({ input })

    expect(getOperationPath(queryKey)).toBe('apps.byAppId.get')
    expect(getOperationInput(queryKey)).toEqual(input)
    expect(getOperationPath(['apps', 'byAppId', 'get'])).toBeUndefined()
  })
})
