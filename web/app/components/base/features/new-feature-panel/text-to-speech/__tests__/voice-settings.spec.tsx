import type { ReactNode } from 'react'
import type { Features } from '../../../types'
import { fireEvent, render, screen } from '@testing-library/react'
import { FeaturesProvider } from '../../../context'
import VoiceSettings from '../voice-settings'

vi.mock('@langgenius/dify-ui/popover', () => import('@/__mocks__/base-ui-popover'))
vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

vi.mock('@/next/navigation', () => ({
  usePathname: () => '/app/test-app-id/configuration',
  useParams: () => ({ appId: 'test-app-id' }),
}))

vi.mock('@/service/use-apps', () => ({
  useAppVoices: () => ({
    data: [{ name: 'alloy', value: 'alloy' }],
  }),
}))

vi.mock('@langgenius/dify-ui/switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
    ...props
  }: {
    checked?: boolean
    onCheckedChange?: (checked: boolean) => void
  }) => (
    <button
      type="button"
      data-testid="switch"
      data-checked={String(checked)}
      onClick={() => onCheckedChange?.(!checked)}
      {...props}
    />
  ),
}))

const defaultFeatures: Features = {
  moreLikeThis: { enabled: false },
  opening: { enabled: false },
  suggested: { enabled: false },
  text2speech: { enabled: true, language: 'en-US', voice: 'alloy' },
  speech2text: { enabled: false },
  citation: { enabled: false },
  moderation: { enabled: false },
  file: { enabled: false },
  annotationReply: { enabled: false },
}

const renderWithProvider = (ui: ReactNode) => {
  return render(
    <FeaturesProvider features={defaultFeatures}>
      {ui}
    </FeaturesProvider>,
  )
}

describe('VoiceSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render children in trigger', () => {
    renderWithProvider(
      <VoiceSettings open={false} onOpen={vi.fn()}>
        <button>Settings</button>
      </VoiceSettings>,
    )

    expect(screen.getByText('Settings'))!.toBeInTheDocument()
  })

  it('should render ParamConfigContent in portal', () => {
    renderWithProvider(
      <VoiceSettings open={true} onOpen={vi.fn()}>
        <button>Settings</button>
      </VoiceSettings>,
    )

    expect(screen.getByText(/voice\.voiceSettings\.title/))!.toBeInTheDocument()
  })

  it('should call onOpen with toggle function when trigger is clicked', () => {
    const onOpen = vi.fn()
    renderWithProvider(
      <VoiceSettings open={false} onOpen={onOpen}>
        <button>Settings</button>
      </VoiceSettings>,
    )

    fireEvent.click(screen.getByText('Settings'))

    expect(onOpen).toHaveBeenCalledWith(true)
  })

  it('should not call onOpen when disabled and trigger is clicked', () => {
    const onOpen = vi.fn()
    renderWithProvider(
      <VoiceSettings open={false} onOpen={onOpen} disabled>
        <button>Settings</button>
      </VoiceSettings>,
    )

    fireEvent.click(screen.getByText('Settings'))

    expect(onOpen).not.toHaveBeenCalled()
  })

  it('should call onOpen with false when close is clicked', () => {
    const onOpen = vi.fn()
    renderWithProvider(
      <VoiceSettings open={true} onOpen={onOpen}>
        <button>Settings</button>
      </VoiceSettings>,
    )

    fireEvent.click(screen.getByRole('button', { name: /voice\.voiceSettings\.close/ }))

    expect(onOpen).toHaveBeenCalledWith(false)
  })

  it('should use top placement and mainAxis 4 when placementLeft is false', () => {
    renderWithProvider(
      <VoiceSettings open={true} onOpen={vi.fn()} placementLeft={false}>
        <button>Settings</button>
      </VoiceSettings>,
    )

    const content = screen.getByTestId('popover-content')
    expect(content).toHaveAttribute('data-placement', 'top')
    expect(content).toHaveAttribute('data-side-offset', '4')
  })
})
