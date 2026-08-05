// oxlint-disable-next-line no-restricted-imports -- the test verifies createApikey's use of the base post()
import { post } from './base'
import { createApikey } from './datasets'

vi.mock('./base', () => ({
  post: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
  patch: vi.fn(),
}))

describe('datasets service - createApikey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('forwards the payload under { body } so it is sent as the request body', () => {
    // Regression: passing `body` directly as the options object drops it (post reads
    // options.body), so dataset_ids never reach the server and the key becomes global.
    createApikey({ url: '/datasets/api-keys', body: { dataset_ids: ['kb-1', 'kb-2'] } })

    expect(post).toHaveBeenCalledWith('/datasets/api-keys', {
      body: { dataset_ids: ['kb-1', 'kb-2'] },
    })
  })

  it('sends an empty dataset_ids body for an unscoped key', () => {
    createApikey({ url: '/datasets/api-keys', body: { dataset_ids: [] } })

    expect(post).toHaveBeenCalledWith('/datasets/api-keys', { body: { dataset_ids: [] } })
  })
})
