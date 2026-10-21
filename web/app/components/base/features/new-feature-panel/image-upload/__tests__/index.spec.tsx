import type { Features, OnFeaturesChange } from '../../../types'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { FeaturesContext, FeaturesProvider } from '../../../context'
import { createFeaturesStore } from '../../../store'
import ImageUpload from '../index'

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'files.upload.get': async () => undefined,
    }),
  }
})

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
  props: { disabled?: boolean; onChange?: OnFeaturesChange } = {},
  featureOverrides?: Partial<Features>,
) => {
  const features = { ...defaultFeatures, ...featureOverrides }
  return render(
    <FeaturesProvider features={features}>
      <ImageUpload disabled={props.disabled ?? false} onChange={props.onChange} />
    </FeaturesProvider>,
  )
}

describe('ImageUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should show supported types when enabled', () => {
    renderWithProvider(
      {},
      {
        file: {
          enabled: true,
          allowed_file_types: ['image'],
          number_limits: 3,
        },
      },
    )

    expect(screen.getByText('image')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('should show info display again when mouse leaves', () => {
    renderWithProvider(
      {},
      {
        file: {
          enabled: true,
          allowed_file_types: ['image'],
          number_limits: 3,
        },
      },
    )

    const card = screen.getByText(/feature\.imageUpload\.title/).closest('[class]')!
    fireEvent.mouseEnter(card)
    fireEvent.mouseLeave(card)

    expect(screen.getByText(/feature\.imageUpload\.supportedTypes/)).toBeInTheDocument()
  })

  it('should show dash when no file types configured', () => {
    renderWithProvider(
      {},
      {
        file: { enabled: true },
      },
    )

    expect(screen.getByText('-')).toBeInTheDocument()
  })

  it('should close setting modal when cancel is clicked', async () => {
    renderWithProvider(
      {},
      {
        file: { enabled: true },
      },
    )

    const card = screen.getByText(/feature\.imageUpload\.title/).closest('[class]')!
    fireEvent.mouseEnter(card)
    fireEvent.click(screen.getByText(/operation\.settings/))

    await waitFor(() => {
      expect(screen.getByText(/feature\.imageUpload\.modalTitle/)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /operation\.cancel/ }))

    await waitFor(() => {
      expect(screen.queryByText(/feature\.imageUpload\.modalTitle/)).not.toBeInTheDocument()
    })
  })
})

it('persists the image feature toggle and honors disabled state', async () => {
  const user = userEvent.setup()
  const store = createFeaturesStore({ features: defaultFeatures })
  const onChange = vi.fn()
  const content = (disabled: boolean) => (
    <FeaturesContext.Provider value={store}>
      <ImageUpload disabled={disabled} onChange={onChange} />
    </FeaturesContext.Provider>
  )
  const { rerender } = render(content(false))
  const toggle = screen.getByRole('switch', { name: /fileUpload.feature.imageUpload.title/ })
  await user.click(toggle)
  expect(toggle).toBeChecked()
  expect(store.getState().features.file).toMatchObject({ enabled: true, image: { enabled: true } })
  expect(onChange).toHaveBeenCalledOnce()
  rerender(content(true))
  expect(toggle).toHaveAttribute('aria-disabled', 'true')
  await user.click(toggle)
  expect(onChange).toHaveBeenCalledOnce()
})
