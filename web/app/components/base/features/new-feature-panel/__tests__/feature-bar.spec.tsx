import type { Features } from '../../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FeaturesProvider } from '../../context'
import FeatureBar from '../feature-bar'

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
    it('should call onFeatureBarClick when empty state is clicked', async () => {
      const onFeatureBarClick = vi.fn()

      renderWithProvider({ onFeatureBarClick })
      const user = userEvent.setup()
      await user.tab()
      await user.keyboard('{Enter}')

      expect(onFeatureBarClick).toHaveBeenCalledWith(true)
    })
  })

  describe('Enabled Features', () => {
    it('should hide manage button when hideEditEntrance is true', () => {
      renderWithProvider(
        { hideEditEntrance: true },
        {
          moreLikeThis: { enabled: true },
        },
      )

      expect(screen.queryByText(/feature\.bar\.manage/)).not.toBeInTheDocument()
    })

    it('should call onFeatureBarClick when manage button is clicked', async () => {
      const onFeatureBarClick = vi.fn()

      renderWithProvider(
        { onFeatureBarClick },
        {
          moreLikeThis: { enabled: true },
        },
      )
      await userEvent.click(screen.getByRole('button', { name: /feature\.bar\.manage/ }))

      expect(onFeatureBarClick).toHaveBeenCalledWith(true)
    })
  })

  describe('Chat Mode Features', () => {
    it('should show enabled text when citation is enabled in chat mode', () => {
      renderWithProvider(
        { isChatMode: true },
        {
          citation: { enabled: true },
        },
      )

      expect(screen.getByText(/feature\.bar\.enableText/)).toBeInTheDocument()
    })

    it('should show empty state when citation is enabled but not in chat mode', () => {
      renderWithProvider(
        { isChatMode: false },
        {
          citation: { enabled: true },
        },
      )

      expect(screen.getByText(/feature\.bar\.empty/)).toBeInTheDocument()
    })

    it('should show enabled text when file is enabled with showFileUpload', () => {
      renderWithProvider(
        { showFileUpload: true },
        {
          file: { enabled: true },
        },
      )

      expect(screen.getByText(/feature\.bar\.enableText/)).toBeInTheDocument()
    })

    it('should show empty state when file is enabled but showFileUpload is false', () => {
      renderWithProvider(
        { showFileUpload: false },
        {
          file: { enabled: true },
        },
      )

      expect(screen.getByText(/feature\.bar\.empty/)).toBeInTheDocument()
    })
  })
})

it.each([false, true])(
  'prevents opening feature management while disabled (enabled features: %s)',
  async (enabled) => {
    const onFeatureBarClick = vi.fn()
    renderWithProvider({ disabled: true, onFeatureBarClick }, { moreLikeThis: { enabled } })
    const action = screen.getByRole('button', {
      name: enabled ? /feature\.bar\.manage/ : /feature\.bar\.empty/,
    })
    expect(action).toBeDisabled()
    await userEvent.click(action)
    expect(onFeatureBarClick).not.toHaveBeenCalled()
  },
)
