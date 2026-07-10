import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentPreviewHeader } from '../header'

function renderHeader({
  mode = 'preview',
  previewEnabled = true,
  onModeChange = vi.fn(),
  onToggleChatFeatures = vi.fn(),
  onOpenWorkingDirectory = vi.fn(),
  onRefresh = vi.fn(),
  refreshDisabled = false,
  showWorkingDirectoryAction = false,
}: {
  mode?: 'build' | 'preview'
  previewEnabled?: boolean
  onModeChange?: (mode: 'build' | 'preview') => void
  onToggleChatFeatures?: () => void
  onOpenWorkingDirectory?: () => void
  onRefresh?: () => void
  refreshDisabled?: boolean
  showWorkingDirectoryAction?: boolean
} = {}) {
  render(
    <AgentPreviewHeader
      mode={mode}
      previewEnabled={previewEnabled}
      isChatFeaturesOpen={false}
      onModeChange={onModeChange}
      onToggleChatFeatures={onToggleChatFeatures}
      onOpenWorkingDirectory={onOpenWorkingDirectory}
      onRefresh={onRefresh}
      refreshDisabled={refreshDisabled}
      showWorkingDirectoryAction={showWorkingDirectoryAction}
    />,
  )
}

describe('AgentPreviewHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should confirm before emitting refresh from the restart button', async () => {
    const user = userEvent.setup()
    const onRefresh = vi.fn()
    renderHeader({ mode: 'build', onRefresh })

    await user.click(screen.getByRole('button', { name: 'agentV2.agentDetail.configure.preview.restart' }))

    expect(onRefresh).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: 'agentV2.agentDetail.configure.clearSessionConfirm.title' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('should not emit refresh when the restart button is disabled', async () => {
    const user = userEvent.setup()
    const onRefresh = vi.fn()
    renderHeader({ mode: 'build', onRefresh, refreshDisabled: true })

    await user.click(screen.getByRole('button', { name: 'agentV2.agentDetail.configure.preview.restart' }))

    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('should show chat features in build mode', async () => {
    const user = userEvent.setup()
    const onToggleChatFeatures = vi.fn()
    renderHeader({ mode: 'build', onToggleChatFeatures })

    await user.click(screen.getByRole('button', { name: 'agentV2.agentDetail.configure.preview.chatFeatures' }))

    expect(onToggleChatFeatures).toHaveBeenCalledTimes(1)
  })

  it('should open the working directory from the build header', async () => {
    const user = userEvent.setup()
    const onOpenWorkingDirectory = vi.fn()
    renderHeader({ mode: 'build', onOpenWorkingDirectory, showWorkingDirectoryAction: true })

    const fileSystemButton = screen.getByRole('button', { name: 'agentV2.agentDetail.configure.workingDirectory.open' })
    expect(fileSystemButton).toHaveTextContent('agentV2.agentDetail.configure.workingDirectory.fileSystem')

    await user.click(fileSystemButton)

    expect(onOpenWorkingDirectory).toHaveBeenCalledTimes(1)
  })

  it('should hide the working directory action when unavailable', () => {
    renderHeader({ mode: 'build' })

    expect(screen.queryByRole('button', { name: 'agentV2.agentDetail.configure.workingDirectory.open' })).not.toBeInTheDocument()
  })

  it('should disable preview mode when preview is unavailable', async () => {
    const user = userEvent.setup()
    const onModeChange = vi.fn()
    renderHeader({
      mode: 'build',
      previewEnabled: false,
      onModeChange,
    })

    const modeControl = screen.getByRole('group', { name: 'agentV2.agentDetail.configure.rightPanel.modeLabel' })

    await user.click(within(modeControl).getByRole('button', { name: 'agentV2.agentDetail.configure.rightPanel.preview' }))

    expect(onModeChange).not.toHaveBeenCalled()
  })

  it('should explain disabled preview mode on hover', async () => {
    const user = userEvent.setup()
    renderHeader({
      mode: 'build',
      previewEnabled: false,
    })

    await user.hover(screen.getByLabelText('agentV2.agentDetail.configure.rightPanel.previewDisabledTip'))

    expect(await screen.findByText('agentV2.agentDetail.configure.rightPanel.previewDisabledTip')).toBeInTheDocument()
  })
})
