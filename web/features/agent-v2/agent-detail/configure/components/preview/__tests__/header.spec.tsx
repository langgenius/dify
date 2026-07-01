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
}: {
  mode?: 'build' | 'preview'
  previewEnabled?: boolean
  onModeChange?: (mode: 'build' | 'preview') => void
  onToggleChatFeatures?: () => void
  onOpenWorkingDirectory?: () => void
  onRefresh?: () => void
  refreshDisabled?: boolean
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
    />,
  )
}

describe('AgentPreviewHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should emit refresh from the restart button', async () => {
    const user = userEvent.setup()
    const onRefresh = vi.fn()
    renderHeader({ mode: 'build', onRefresh })

    await user.click(screen.getByRole('button', { name: 'agentV2.agentDetail.configure.preview.restart' }))

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
    renderHeader({ mode: 'build', onOpenWorkingDirectory })

    await user.click(screen.getByRole('button', { name: 'agentV2.agentDetail.configure.workingDirectory.open' }))

    expect(onOpenWorkingDirectory).toHaveBeenCalledTimes(1)
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

    await user.click(within(modeControl).getByRole('button', { name: /agentV2\.agentDetail\.configure\.rightPanel\.preview/ }))

    expect(onModeChange).not.toHaveBeenCalled()
  })
})
