import type { HumanInputFormSubmitData } from '@/app/components/base/chat/chat/answer/human-input-content/type'
import { submitHumanInputForm } from '../workflow'

const mocks = vi.hoisted(() => ({ legacyPost: vi.fn(), approveV2: vi.fn() }))
vi.mock('../base', () => ({ get: vi.fn(), post: mocks.legacyPost }))
vi.mock('../console', () => ({
  consoleClient: {
    form: {
      humanInput: {
        byFormToken: { post: mocks.legacyPost },
        v2: { byFormToken: { post: mocks.approveV2 } },
      },
    },
  },
}))

describe('Console human input submission', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses the authenticated v2 contract for v2 nodes', async () => {
    const data = { action: 'approve', inputs: { note: 'Approved' } }
    await submitHumanInputForm('opaque-token', data, '2')
    expect(mocks.approveV2).toHaveBeenCalledWith({
      params: { form_token: 'opaque-token' },
      body: data,
    })
    expect(mocks.legacyPost).not.toHaveBeenCalled()
  })

  it('keeps workflow preview routing metadata out of the v2 request body', async () => {
    const data: HumanInputFormSubmitData = {
      action: 'approve',
      inputs: { note: 'Approved' },
      form_version: '2',
    }

    await submitHumanInputForm('opaque-token', data, data.form_version)

    expect(mocks.approveV2).toHaveBeenCalledWith({
      params: { form_token: 'opaque-token' },
      body: { action: 'approve', inputs: { note: 'Approved' } },
    })
    expect(data.form_version).toBe('2')
    expect(mocks.legacyPost).not.toHaveBeenCalled()
  })

  it('preserves legacy node submission', async () => {
    const data = { action: 'approve', inputs: { note: 'Approved' } }
    await submitHumanInputForm('legacy-token', data)
    expect(mocks.legacyPost).toHaveBeenCalledWith({
      params: { form_token: 'legacy-token' },
      body: data,
    })
    expect(mocks.approveV2).not.toHaveBeenCalled()
  })
})
