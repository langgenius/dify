import type { Features } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { FeaturesProvider } from '../context'
import FeatureBar from './feature-bar'

// Mock VoiceSettings to avoid complex child dependencies
vi.mock('@/app/components/base/features/new-feature-panel/text-to-speech/voice-settings', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="voice-settings">{children}</div>,
}))

const defaultFeatures: Features = {
  moreLikeThis: { enabled: false },
  opening: { enabled: false },
  suggested: { enabled: false },
  text2speech: { enabled: false },
  speech2text: { enabled: false },
  citation: { enabled: false },
  moderation: { enabled: false },
  file: { enabled: false },
  annotationReply: { enabled: false },
}

const renderWithProvider = (
  props: {
    isChatMode?: boolean
    showFileUpload?: boolean
    disabled?: boolean
    onFeatureBarClick?: (state: boolean) => void
    hideEditEntrance?: boolean
  } = {},
  featureOverrides?: Partial<Features>,
) => {
  const features = { ...defaultFeatures, ...featureOverrides }
  return render(
    <FeaturesProvider features={features}>
      <FeatureBar {...props} />
    </FeaturesProvider>,
  )
}

describe('FeatureBar', () => {
  it('should render empty state when no features are enabled', () => {
    renderWithProvider()

    expect(screen.getByText(/feature\.bar\.empty/)).toBeInTheDocument()
  })

  it('should call onFeatureBarClick when empty state is clicked', () => {
    const onFeatureBarClick = vi.fn()
    renderWithProvider({ onFeatureBarClick })

    fireEvent.click(screen.getByText(/feature\.bar\.empty/))

    expect(onFeatureBarClick).toHaveBeenCalledWith(true)
  })

  it('should show enabled text when features are enabled', () => {
    renderWithProvider({}, {
      moreLikeThis: { enabled: true },
    })

    expect(screen.getByText(/feature\.bar\.enableText/)).toBeInTheDocument()
  })

  it('should show manage button when features are enabled', () => {
    renderWithProvider({}, {
      moreLikeThis: { enabled: true },
    })

    expect(screen.getByText(/feature\.bar\.manage/)).toBeInTheDocument()
  })

  it('should hide manage button when hideEditEntrance is true', () => {
    renderWithProvider({ hideEditEntrance: true }, {
      moreLikeThis: { enabled: true },
    })

    expect(screen.queryByText(/feature\.bar\.manage/)).not.toBeInTheDocument()
  })

  it('should call onFeatureBarClick when manage button is clicked', () => {
    const onFeatureBarClick = vi.fn()
    renderWithProvider({ onFeatureBarClick }, {
      moreLikeThis: { enabled: true },
    })

    fireEvent.click(screen.getByText(/feature\.bar\.manage/))

    expect(onFeatureBarClick).toHaveBeenCalledWith(true)
  })

  it('should show citation icon in chat mode when citation is enabled', () => {
    renderWithProvider({ isChatMode: true }, {
      citation: { enabled: true },
    })

    expect(screen.getByText(/feature\.bar\.enableText/)).toBeInTheDocument()
  })

  it('should not show citation in non-chat mode', () => {
    renderWithProvider({ isChatMode: false }, {
      citation: { enabled: true },
    })

    // Citation disabled in non-chat mode, so noFeatureEnabled should be true
    expect(screen.getByText(/feature\.bar\.empty/)).toBeInTheDocument()
  })

  it('should show opening feature icon when enabled in chat mode', () => {
    renderWithProvider({ isChatMode: true }, {
      opening: { enabled: true },
    })

    expect(screen.getByText(/feature\.bar\.enableText/)).toBeInTheDocument()
  })

  it('should show file feature icon when showFileUpload and file enabled', () => {
    renderWithProvider({ showFileUpload: true }, {
      file: { enabled: true },
    })

    expect(screen.getByText(/feature\.bar\.enableText/)).toBeInTheDocument()
  })

  it('should not show file feature when showFileUpload is false', () => {
    renderWithProvider({ showFileUpload: false }, {
      file: { enabled: true },
    })

    // File is hidden, so noFeatureEnabled
    expect(screen.getByText(/feature\.bar\.empty/)).toBeInTheDocument()
  })

  it('should show speech2text icon when enabled in chat mode', () => {
    renderWithProvider({ isChatMode: true }, {
      speech2text: { enabled: true },
    })

    expect(screen.getByText(/feature\.bar\.enableText/)).toBeInTheDocument()
  })

  it('should show text2speech icon when enabled', () => {
    renderWithProvider({ isChatMode: true }, {
      text2speech: { enabled: true },
    })

    expect(screen.getByText(/feature\.bar\.enableText/)).toBeInTheDocument()
    expect(screen.getByTestId('voice-settings')).toBeInTheDocument()
  })

  it('should show moderation icon when enabled', () => {
    renderWithProvider({ isChatMode: true }, {
      moderation: { enabled: true },
    })

    expect(screen.getByText(/feature\.bar\.enableText/)).toBeInTheDocument()
  })

  it('should show suggested icon when enabled', () => {
    renderWithProvider({ isChatMode: true }, {
      suggested: { enabled: true },
    })

    expect(screen.getByText(/feature\.bar\.enableText/)).toBeInTheDocument()
  })

  it('should show annotation reply icon in chat mode when enabled', () => {
    renderWithProvider({ isChatMode: true }, {
      annotationReply: { enabled: true },
    })

    expect(screen.getByText(/feature\.bar\.enableText/)).toBeInTheDocument()
  })
})
