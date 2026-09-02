import type { SessionView } from '@/app/components/dify-builder/types'
import type { HeaderProps } from '@/app/components/workflow/header'
import { render, screen } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { difyBuilderSessionViewAtom } from '@/app/components/dify-builder/state'
import { baseProviderContextValue, ProviderContext } from '@/context/provider-context'
import WorkflowHeader from '../index'

const mocks = vi.hoisted(() => ({
  header: vi.fn(),
  resetWorkflowVersionHistory: vi.fn(),
  setCurrentLogItem: vi.fn(),
  setShowMessageLogModal: vi.fn(),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: <T,>(
    selector: (state: {
      appDetail: { id: string }
      setCurrentLogItem: typeof mocks.setCurrentLogItem
      setShowMessageLogModal: typeof mocks.setShowMessageLogModal
    }) => T,
  ) =>
    selector({
      appDetail: { id: 'app-1' },
      setCurrentLogItem: mocks.setCurrentLogItem,
      setShowMessageLogModal: mocks.setShowMessageLogModal,
    }),
}))

vi.mock('@/app/components/workflow/header', () => ({
  default: (props: HeaderProps) => {
    mocks.header(props)
    return props.normal?.controls?.showDifyBuilderButton ? (
      <button type="button">Builder</button>
    ) : null
  },
}))

vi.mock('@/service/use-workflow', () => ({
  useResetWorkflowVersionHistory: () => mocks.resetWorkflowVersionHistory,
}))

vi.mock('../../../hooks/use-is-chat-mode', () => ({
  useIsChatMode: () => false,
}))

vi.mock('../chat-variable-trigger', () => ({
  default: () => null,
}))

vi.mock('../features-trigger', () => ({
  default: () => null,
}))

const renderHeader = (difyBuilderEnabled: boolean, sessionView: SessionView | null = null) => {
  const store = createStore()
  store.set(difyBuilderSessionViewAtom, sessionView)

  return render(
    <Provider store={store}>
      {/* oxlint-disable-next-line eslint-react/no-context-provider -- use-context-selector requires its special provider. */}
      <ProviderContext.Provider value={{ ...baseProviderContextValue, difyBuilderEnabled }}>
        <WorkflowHeader />
      </ProviderContext.Provider>
    </Provider>,
  )
}

describe('WorkflowHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should hide Builder while its feature is disabled', () => {
    renderHeader(false)

    expect(screen.queryByRole('button', { name: 'Builder' })).not.toBeInTheDocument()
  })

  it('should show Builder after its feature is enabled', () => {
    renderHeader(true)

    expect(screen.getByRole('button', { name: 'Builder' })).toBeInTheDocument()
  })

  it('should tell the shared header when an existing Builder session can be resumed', () => {
    renderHeader(true, {
      app_id: 'app-1',
      canvas_read_only: true,
      conversation: [],
      interrupted: true,
      run_status: 'executing',
      session_id: 'session-1',
      state: 'build.publish',
      version: 1,
    })

    expect(mocks.header).toHaveBeenLastCalledWith(
      expect.objectContaining({
        normal: expect.objectContaining({
          controls: expect.objectContaining({
            hasDifyBuilderSession: true,
          }),
        }),
      }),
    )
  })
})
