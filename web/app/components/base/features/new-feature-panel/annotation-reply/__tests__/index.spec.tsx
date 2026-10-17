import type { Features, OnFeaturesChange } from '../../../types'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/notifications'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { FeaturesProvider } from '../../../context'
import AnnotationReply from '../index'

const { updateStatus, getStatus } = vi.hoisted(() => ({
  updateStatus: vi.fn(),
  getStatus: vi.fn(),
}))
vi.mock('@/next/navigation', () => ({ usePathname: () => '/app/test-app-id/configuration' }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'apps.byAppId.annotationReply.byAction.post': (input) => updateStatus(input),
      'apps.byAppId.annotationReply.byAction.status.byJobId.get': (input) => getStatus(input),
    }),
  }
})
vi.mock(
  '@/app/components/header/account-setting/model-provider-page/hooks',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/app/components/header/account-setting/model-provider-page/hooks')
    >()),
    useModelListAndDefaultModelAndCurrentProviderAndModel: () => ({
      modelList: [],
      defaultModel: { provider: { provider: 'openai' }, model: 'embedding-model' },
      currentModel: true,
    }),
  }),
)
// Model selection and billing purchase flows have separate integration suites.
vi.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => ({
  ModelSelector: () => null,
}))
vi.mock('@/app/components/billing/annotation-full/modal', () => ({
  default: ({ onHide }: { onHide: () => void }) => (
    <div role="dialog" aria-label="Annotation limit">
      <button onClick={onHide}>Close limit</button>
    </div>
  ),
}))

const embeddingModel = {
  embedding_provider_name: 'openai',
  embedding_model_name: 'embedding-model',
}
const defaultFeatures: Features = {
  moreLikeThis: { enabled: false },
  opening: { enabled: false },
  suggested: { enabled: false },
  text2speech: { enabled: false },
  speech2text: { enabled: false },
  citation: { enabled: false },
  moderation: { enabled: false },
  file: { enabled: false },
  annotationReply: { enabled: false, score_threshold: 0.8, embedding_model: embeddingModel },
}
function renderFeature({
  enabled = false,
  score = 0.8,
  disabled = false,
  onChange,
  full = false,
}: {
  enabled?: boolean
  score?: number
  disabled?: boolean
  onChange?: OnFeaturesChange
  full?: boolean
} = {}) {
  return renderWithConsoleQuery(
    <FeaturesProvider
      features={{
        ...defaultFeatures,
        annotationReply: { enabled, score_threshold: score, embedding_model: embeddingModel },
      }}
    >
      <AnnotationReply disabled={disabled} onChange={onChange} />
    </FeaturesProvider>,
    {
      systemFeatures: { deployment_edition: 'CLOUD' },
      features: { annotation_quota_limit: { size: full ? 10 : 0, limit: 10 } },
    },
  )
}
const configDialog = () => screen.findByRole('dialog', { name: /initSetup.title/ })
const save = () => screen.getByRole('button', { name: /initSetup.confirmBtn/ })

describe('AnnotationReply', () => {
  beforeEach(() => {
    updateStatus.mockReset().mockResolvedValue({ job_id: 'job-1', job_status: 'waiting' })
    getStatus.mockReset().mockResolvedValue({ job_status: 'completed' })
  })
  afterEach(() => vi.restoreAllMocks())

  it('enables annotation only after the background job completes and notifies its owner', async () => {
    const user = userEvent.setup({ skipHover: true })
    const onChange = vi.fn()
    const status = createDeferred<{ job_status: string }>()
    getStatus.mockReturnValueOnce(status.promise)
    renderFeature({ onChange })
    expect(screen.getByText(/feature.annotation.description/)).toBeInTheDocument()
    await user.click(screen.getByRole('switch'))
    await configDialog()
    await user.click(save())
    await waitFor(() =>
      expect(getStatus).toHaveBeenCalledWith({
        params: { app_id: 'test-app-id', action: 'enable', job_id: 'job-1' },
      }),
    )
    expect(updateStatus).toHaveBeenCalledExactlyOnceWith({
      params: { app_id: 'test-app-id', action: 'enable' },
      body: { score_threshold: 0.8, ...embeddingModel },
    })
    expect(onChange).not.toHaveBeenCalled()
    expect(save()).toHaveAttribute('aria-disabled', 'true')
    await act(async () => status.resolve({ job_status: 'completed' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('switch')).toBeChecked()
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('disables annotation and updates the feature without requiring an onChange callback', async () => {
    const user = userEvent.setup({ skipHover: true })
    renderFeature({ enabled: true })
    await user.click(screen.getByRole('switch'))
    await waitFor(() => expect(screen.getByRole('switch')).not.toBeChecked())
    expect(updateStatus).toHaveBeenCalledWith(
      expect.objectContaining({ params: { app_id: 'test-app-id', action: 'disable' } }),
    )
    expect(screen.getByText(/feature.annotation.description/)).toBeInTheDocument()
  })

  it('keeps the feature enabled after disabling fails and allows retry', async () => {
    const user = userEvent.setup({ skipHover: true })
    const notify = vi.spyOn(toast, 'error').mockImplementation(() => '')
    updateStatus.mockRejectedValueOnce(new Error('Unavailable'))
    renderFeature({ enabled: true })
    await user.click(screen.getByRole('switch'))
    await waitFor(() => expect(notify).toHaveBeenCalledWith('common.api.actionFailed'))
    expect(screen.getByRole('switch')).toBeChecked()
    await user.click(screen.getByRole('switch'))
    await waitFor(() => expect(screen.getByRole('switch')).not.toBeChecked())
  })

  it('keeps failed setup open and allows retry without enabling the feature prematurely', async () => {
    const user = userEvent.setup({ skipHover: true })
    const notify = vi.spyOn(toast, 'error').mockImplementation(() => '')
    getStatus.mockResolvedValueOnce({ job_status: 'error', error_msg: 'Indexing failed' })
    const onChange = vi.fn()
    renderFeature({ onChange })
    await user.click(screen.getByRole('switch'))
    await configDialog()
    await user.click(save())
    await waitFor(() => expect(notify).toHaveBeenCalledWith('common.api.actionFailed'))
    expect(onChange).not.toHaveBeenCalled()
    expect(save()).toBeEnabled()
    await user.click(save())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('switch')).toBeChecked()
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('discards canceled parameter edits when reopening configuration', async () => {
    const user = userEvent.setup({ skipHover: true })
    renderFeature({ enabled: true })
    await user.hover(screen.getByText(/feature.annotation.title/))
    expect(
      screen.getByRole('link', { name: /feature.annotation.cacheManagement/ }),
    ).toHaveAttribute('href', '/app/test-app-id/annotations')
    await user.click(screen.getByRole('button', { name: 'common.operation.params' }))
    const dialog = await configDialog()
    const slider = within(dialog).getByRole('slider')
    slider.focus()
    await user.keyboard('{Home}')
    expect(slider).toHaveAttribute('aria-valuenow', '0')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.hover(screen.getByText(/feature.annotation.title/))
    await user.click(screen.getByRole('button', { name: 'common.operation.params' }))
    expect(within(await configDialog()).getByRole('slider')).toHaveAttribute('aria-valuenow', '0.8')
    expect(updateStatus).not.toHaveBeenCalled()
  })

  it('preserves a zero score and restores the info after leaving the card', async () => {
    const user = userEvent.setup({ skipHover: true })
    renderFeature({ enabled: true, score: 0 })
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('embedding-model')).toBeInTheDocument()
    await user.hover(screen.getByText(/feature.annotation.title/))
    expect(screen.queryByText('0')).not.toBeInTheDocument()
    await user.unhover(screen.getByText(/feature.annotation.title/))
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('shows the quota dialog instead of configuration when the limit is reached', async () => {
    const user = userEvent.setup({ skipHover: true })
    renderFeature({ full: true })
    await user.click(screen.getByRole('switch'))
    expect(screen.getByRole('dialog', { name: 'Annotation limit' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: /initSetup.title/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close limit' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(updateStatus).not.toHaveBeenCalled()
  })

  it('does not allow configuration when the feature is disabled by its owner', async () => {
    renderFeature({ disabled: true })
    const toggle = screen.getByRole('switch')
    expect(toggle).toHaveAttribute('aria-disabled', 'true')
    await userEvent.setup({ skipHover: true }).click(toggle)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(updateStatus).not.toHaveBeenCalled()
  })
})
