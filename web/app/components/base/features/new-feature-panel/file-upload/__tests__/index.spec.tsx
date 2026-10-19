import type { Features, OnFeaturesChange } from '../../../types'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { FeaturesContext, FeaturesProvider } from '../../../context'
import { createFeaturesStore } from '../../../store'
import FileUpload from '../index'

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
      <FileUpload disabled={props.disabled ?? false} onChange={props.onChange} />
    </FeaturesProvider>,
  )
}

describe('FileUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should show supported types when enabled', () => {
    renderWithProvider(
      {},
      {
        file: {
          enabled: true,
          allowed_file_types: ['image', 'document'],
          number_limits: 5,
        },
      },
    )

    expect(screen.getByText('image,document')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('should show dash when no allowed file types', () => {
    renderWithProvider(
      {},
      {
        file: {
          enabled: true,
        },
      },
    )

    expect(screen.getByText('-')).toBeInTheDocument()
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

    const card = screen.getByText(/feature\.fileUpload\.title/).closest('[class]')!
    fireEvent.mouseEnter(card)
    fireEvent.mouseLeave(card)

    expect(screen.getByText(/feature\.fileUpload\.supportedTypes/)).toBeInTheDocument()
  })

  it('should close setting modal when cancel is clicked', async () => {
    renderWithProvider(
      {},
      {
        file: { enabled: true },
      },
    )

    const card = screen.getByText(/feature\.fileUpload\.title/).closest('[class]')!
    fireEvent.mouseEnter(card)
    fireEvent.click(screen.getByText(/operation\.settings/))

    await waitFor(() => {
      expect(screen.getByText(/feature\.fileUpload\.modalTitle/)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /operation\.cancel/ }))

    await waitFor(() => {
      expect(screen.queryByText(/feature\.fileUpload\.modalTitle/)).not.toBeInTheDocument()
    })
  })
})

it('persists enabled state in both file settings and the legacy image flag', async () => {
  const user = userEvent.setup()
  const store = createFeaturesStore({ features: defaultFeatures })
  const onChange = vi.fn()
  render(
    <FeaturesContext.Provider value={store}>
      <FileUpload disabled={false} onChange={onChange} />
    </FeaturesContext.Provider>,
  )
  const toggle = screen.getByRole('switch', { name: 'fileUpload.feature.fileUpload.title' })
  await user.click(toggle)
  expect(store.getState().features.file).toMatchObject({ enabled: true, image: { enabled: true } })
  expect(toggle).toBeChecked()
  await user.click(toggle)
  expect(store.getState().features.file).toMatchObject({
    enabled: false,
    image: { enabled: false },
  })
  expect(onChange).toHaveBeenCalledTimes(2)
})

it('blocks enabling upload when disabled', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  renderWithProvider({ disabled: true, onChange })
  const toggle = screen.getByRole('switch')
  expect(toggle).toHaveAttribute('aria-disabled', 'true')
  await user.click(toggle)
  expect(onChange).not.toHaveBeenCalled()
})
