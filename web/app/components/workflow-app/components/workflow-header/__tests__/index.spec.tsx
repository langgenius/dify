import type { HeaderProps } from '@/app/components/workflow/header'
import type { SessionView } from '@/features/dify-builder/types'
import { screen } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { EditorResourceScope } from '@/app/components/workflow/editor-resource/provider'
import { difyBuilderSessionViewAtom } from '@/features/dify-builder/session/state'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { renderWorkflowComponent } from '../../../__tests__/workflow-test-env'
import WorkflowHeader from '../index'

const mocks = vi.hoisted(() => ({
  header: vi.fn(),
  resetWorkflowVersionHistory: vi.fn(),
}))

vi.mock('@/app/components/workflow/header', () => ({
  default: (props: HeaderProps) => {
    mocks.header(props)
    return props.normal?.components?.actions
  },
}))

vi.mock('@/service/use-workflow', () => ({
  useResetWorkflowVersionHistory: () => mocks.resetWorkflowVersionHistory,
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
  const { queryClient } = createConsoleQueryWrapper({
    features: { dify_builder_enabled: difyBuilderEnabled },
  })

  return renderWorkflowComponent(
    <Provider store={store}>
      <EditorResourceScope
        resource={{ kind: 'app', appId: 'app-1', mode: 'workflow', collaborationEnabled: false }}
      >
        <WorkflowHeader />
      </EditorResourceScope>
    </Provider>,
    { queryClient, initialStoreState: { canvasReadOnly: !!sessionView } },
  )
}

describe('WorkflowHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should hide Builder while its feature is disabled', () => {
    renderHeader(false)

    expect(
      screen.queryByRole('button', { name: 'difyBuilder.buttonTooltip' }),
    ).not.toBeInTheDocument()
  })

  it('should show Builder after its feature is enabled', () => {
    renderHeader(true)

    expect(screen.getByRole('button', { name: 'difyBuilder.buttonTooltip' })).toBeEnabled()
  })

  it('keeps an existing Builder session available while canvas editing is locked', () => {
    renderHeader(true, {
      canvas_read_only: true,
      conversation_last_seq: -1,
      interrupted: true,
      phase: 'publish',
      run_status: 'processing',
      reply_language: '',
      session_id: 'session-1',
      version: 1,
    })

    expect(screen.getByRole('button', { name: 'difyBuilder.buttonTooltip' })).toBeEnabled()
  })
})
