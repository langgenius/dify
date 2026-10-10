import type { ModalState } from '../modal-context'
import type { ModerationConfig } from '@/models/debug'
import { act, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render } from '@/test/console/render'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { useModalContext } from '../modal-context'
import { ModalContextProvider } from '../modal-context-provider'

const { loadDialog, getExtensions } = vi.hoisted(() => ({
  loadDialog: vi.fn(),
  getExtensions: vi.fn(),
}))

vi.mock('next/dynamic', async (importOriginal) => {
  const { default: dynamic } = await importOriginal<typeof import('next/dynamic')>()
  return {
    default: (loader: () => Promise<unknown>, options: object) =>
      dynamic(
        (() => {
          loadDialog()
          return loader()
        }) as Parameters<typeof dynamic>[0],
        options,
      ),
  }
})

vi.mock('@/service/use-common', () => ({
  useCodeBasedExtensions: () => ({ data: { data: [] } }),
  useModelProviderDetails: () => ({ data: { data: [] }, isPending: false }),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { createConsoleQuery } = await import('@/service/console/query-policies')
  const consoleClient = new Proxy(actual.consoleClient, {
    get(target, property, receiver) {
      if (property === 'apiBasedExtension')
        return { ...target.apiBasedExtension, get: getExtensions }
      return Reflect.get(target, property, receiver)
    },
  })
  return { ...actual, consoleClient, consoleQuery: createConsoleQuery(consoleClient) }
})

const moderation: ModerationConfig = {
  enabled: true,
  type: 'keywords',
  config: {
    keywords: 'Original keyword',
    inputs_config: { enabled: true, preset_response: 'Original reply' },
  },
}
const moderationName = 'appDebug.feature.moderation.modal.title'
const keywordsName = 'appDebug.feature.moderation.modal.provider.keywords'
const cancelName = 'common.operation.cancel'
const saveName = 'common.operation.save'

function Entries({
  onSave,
  onCancel,
}: {
  onSave?: ModalState<ModerationConfig>['onSaveCallback']
  onCancel?: () => void
}) {
  const modal = useModalContext()
  return (
    <>
      <output>{modal.hasBlockingModalOpen ? 'blocked' : 'clear'}</output>
      <button
        onClick={() =>
          modal.setShowModerationSettingModal({
            payload: moderation,
            onSaveCallback: onSave,
            onCancelCallback: onCancel,
          })
        }
      >
        Open moderation
      </button>
      <button onClick={() => modal.setShowExternalDataToolModal({ payload: {} })}>
        Open external tool
      </button>
      <button
        onClick={() =>
          modal.setShowOpeningModal({
            payload: { enabled: true, opening_statement: 'Welcome', suggested_questions: [] },
          })
        }
      >
        Open opener
      </button>
      <button onClick={modal.setShowAnnotationFullModal}>Open annotation limit</button>
    </>
  )
}

function createProviderWrapper() {
  const { wrapper: QueryWrapper } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: 'COMMUNITY' },
    features: { annotation_quota_limit: { size: 100, limit: 100 } },
  })
  const { wrapper: NuqsWrapper } = createNuqsTestWrapper()
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryWrapper>
        <NuqsWrapper>
          <ModalContextProvider>{children}</ModalContextProvider>
        </NuqsWrapper>
      </QueryWrapper>
    )
  }
}

function renderEntries(props: Parameters<typeof Entries>[0] = {}) {
  return render(<Entries {...props} />, { wrapper: createProviderWrapper() })
}

beforeEach(() => {
  getExtensions.mockResolvedValue([])
})

it('activates each dynamic owner only on first use and retains it across close and reopen', async () => {
  const user = userEvent.setup()
  renderEntries()
  expect(loadDialog).not.toHaveBeenCalled()

  for (const entry of [
    'Open moderation',
    'Open external tool',
    'Open opener',
    'Open annotation limit',
  ]) {
    const closeName = entry === 'Open annotation limit' ? 'common.operation.close' : cancelName
    const callsBeforeOpen = loadDialog.mock.calls.length
    await user.click(screen.getByRole('button', { name: entry }))
    await screen.findByRole('dialog')
    expect(loadDialog).toHaveBeenCalledTimes(callsBeforeOpen + 1)
    expect(screen.getByText('blocked')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: closeName }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText('clear')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: entry }))
    await screen.findByRole('dialog')
    expect(loadDialog).toHaveBeenCalledTimes(callsBeforeOpen + 1)
    await user.click(screen.getByRole('button', { name: closeName }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  }
})

it('runs the existing Cancel callback once on Escape and resets the next popup draft', async () => {
  const user = userEvent.setup()
  const onCancel = vi.fn()
  renderEntries({ onCancel })
  await user.click(screen.getByRole('button', { name: 'Open moderation' }))
  await screen.findByRole('dialog', { name: moderationName })
  const keywords = screen.getByRole('textbox', { name: keywordsName })
  await user.clear(keywords)
  await user.type(keywords, 'Unsaved change')
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(onCancel).toHaveBeenCalledTimes(1)
  expect(screen.getByText('clear')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Open moderation' }))
  await screen.findByRole('dialog', { name: moderationName })
  expect(screen.getByRole('textbox', { name: keywordsName })).toHaveValue('Original keyword')
})

it('keeps the existing synchronous save then close contract even when a callback returns a pending Promise', async () => {
  const user = userEvent.setup()
  const onSave = vi.fn(() => new Promise<void>(() => {}))
  const onCancel = vi.fn()
  renderEntries({ onSave, onCancel })
  await user.click(screen.getByRole('button', { name: 'Open moderation' }))
  await screen.findByRole('dialog', { name: moderationName })
  await user.click(screen.getByRole('button', { name: saveName }))
  expect(onSave).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      type: 'keywords',
      config: expect.objectContaining({ keywords: 'Original keyword' }),
    }),
  )
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(onCancel).not.toHaveBeenCalled()
})

it('preserves functional setters seeing the active value and null after dismissal', async () => {
  const user = userEvent.setup()
  const { result } = renderHook(useModalContext, { wrapper: createProviderWrapper() })
  const update = vi.fn((current: ModalState<ModerationConfig> | null) => current)
  act(() => result.current.setShowModerationSettingModal(update))
  expect(update).toHaveBeenLastCalledWith(null)
  act(() => result.current.setShowModerationSettingModal({ payload: moderation }))
  await screen.findByRole('dialog', { name: moderationName })
  act(() => result.current.setShowModerationSettingModal(update))
  expect(update).toHaveBeenLastCalledWith({ payload: moderation })
  await user.click(screen.getByRole('button', { name: cancelName }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  act(() => result.current.setShowModerationSettingModal(update))
  expect(update).toHaveBeenLastCalledWith(null)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
