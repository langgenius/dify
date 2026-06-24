import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentPreviewHeader } from '../header'

function renderHeader({
  mode = 'preview',
  previewEnabled = true,
  onModeChange = vi.fn(),
  onOpenVersions = vi.fn(),
  onRefresh = vi.fn(),
}: {
  mode?: 'build' | 'preview'
  previewEnabled?: boolean
  onModeChange?: (mode: 'build' | 'preview') => void
  onOpenVersions?: () => void
  onRefresh?: () => void
} = {}) {
  render(
    <AgentPreviewHeader
      mode={mode}
      previewEnabled={previewEnabled}
      isChatFeaturesOpen={false}
      onModeChange={onModeChange}
      onToggleChatFeatures={vi.fn()}
      onOpenVersions={onOpenVersions}
      onRefresh={onRefresh}
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

  it('should disable preview mode when preview is unavailable', async () => {
    const user = userEvent.setup()
    const onModeChange = vi.fn()
    renderHeader({
      mode: 'build',
      previewEnabled: false,
      onModeChange,
    })

    await user.click(screen.getByRole('button', { name: /agentV2\.agentDetail\.configure\.rightPanel\.preview/ }))

    expect(onModeChange).not.toHaveBeenCalled()
  })
})
