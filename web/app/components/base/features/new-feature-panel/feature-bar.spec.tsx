import type { Features } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import { FeaturesProvider } from '../context'
import FeatureBar from './feature-bar'

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
  describe('Empty State', () => {
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
  })

  describe('Enabled Features', () => {
    it('should show enabled text when moreLikeThis is enabled', () => {
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
  })

  describe('Chat Mode Features', () => {
    it('should show enabled text when citation is enabled in chat mode', () => {
      renderWithProvider({ isChatMode: true }, {
        citation: { enabled: true },
      })

      expect(screen.getByText(/feature\.bar\.enableText/)).toBeInTheDocument()
    })

    it('should show empty state when citation is enabled but not in chat mode', () => {
      renderWithProvider({ isChatMode: false }, {
        citation: { enabled: true },
      })

      expect(screen.getByText(/feature\.bar\.empty/)).toBeInTheDocument()
    })

    it('should show enabled text when opening is enabled in chat mode', () => {
      renderWithProvider({ isChatMode: true }, {
        opening: { enabled: true },
      })

      expect(screen.getByText(/feature\.bar\.enableText/)).toBeInTheDocument()
    })

    it('should show enabled text when file is enabled with showFileUpload', () => {
      renderWithProvider({ showFileUpload: true }, {
        file: { enabled: true },
      })

      expect(screen.getByText(/feature\.bar\.enableText/)).toBeInTheDocument()
    })

    it('should show empty state when file is enabled but showFileUpload is false', () => {
      renderWithProvider({ showFileUpload: false }, {
        file: { enabled: true },
      })

      expect(screen.getByText(/feature\.bar\.empty/)).toBeInTheDocument()
    })

    it('should show enabled text when speech2text is enabled in chat mode', () => {
      renderWithProvider({ isChatMode: true }, {
        speech2text: { enabled: true },
      })

      expect(screen.getByText(/feature\.bar\.enableText/)).toBeInTheDocument()
    })

    it('should show enabled text when text2speech is enabled', () => {
      renderWithProvider({ isChatMode: true }, {
        text2speech: { enabled: true },
      })

      expect(screen.getByText(/feature\.bar\.enableText/)).toBeInTheDocument()
    })

    it('should show enabled text when moderation is enabled', () => {
      renderWithProvider({ isChatMode: true }, {
        moderation: { enabled: true },
      })

      expect(screen.getByText(/feature\.bar\.enableText/)).toBeInTheDocument()
    })

    it('should show enabled text when suggested is enabled', () => {
      renderWithProvider({ isChatMode: true }, {
        suggested: { enabled: true },
      })

      expect(screen.getByText(/feature\.bar\.enableText/)).toBeInTheDocument()
    })

    it('should show enabled text when annotationReply is enabled in chat mode', () => {
      renderWithProvider({ isChatMode: true }, {
        annotationReply: { enabled: true },
      })

      expect(screen.getByText(/feature\.bar\.enableText/)).toBeInTheDocument()
    })
  })
})
