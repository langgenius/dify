import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockEmojiData, renderWithEmoji as render } from '@/test/emoji-picker'
import { ExternalDataToolModal } from '../external-data-tool-modal'

const mockToastError = vi.fn()

let mockLocale = 'en-US'
vi.mock('@/app/components/app/configuration/toast', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.com${path}`,
}))

vi.mock('#i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#i18n')>()),
  useLocale: () => mockLocale,
}))

vi.mock('@/service/use-common', () => ({
  useCodeBasedExtensions: () => ({
    data: {
      data: [
        {
          name: 'code-tool',
          label: {
            'en-US': 'Code Provider',
            'zh-Hans': '代码提供方',
          },
          form_schema: [
            {
              variable: 'api_key',
              default: 'default-key',
              required: true,
              type: 'text',
              placeholder: '',
              options: [],
              label: {
                'en-US': 'API Key',
                'zh-Hans': '接口密钥',
              },
            },
          ],
        },
      ],
    },
  }),
}))

vi.mock('@/app/components/base/features/new-feature-panel/moderation/form-generation', () => ({
  default: ({ onChange }: { onChange: (value: Record<string, string>) => void }) => (
    <button type="button" onClick={() => onChange({ api_key: 'secret-key' })}>
      fill-form
    </button>
  ),
}))

vi.mock('@/app/components/header/account-setting/api-based-extension-page/selector', () => ({
  ApiBasedExtensionSelector: ({
    onChange,
    value,
  }: {
    onChange: (value: string) => void
    value: string
  }) => (
    <button type="button" onClick={() => onChange('extension-1')}>
      {value || 'pick-extension'}
    </button>
  ),
}))

describe('ExternalDataToolModal', () => {
  const mockOnCancel = vi.fn()
  const mockOnSave = vi.fn()
  const mockOnValidateBeforeSave = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockLocale = 'en-US'
  })

  it('should require an API extension before saving api-based tools', () => {
    render(<ExternalDataToolModal open data={{}} onOpenChange={mockOnCancel} onSave={mockOnSave} />)

    fireEvent.change(
      screen.getByPlaceholderText(/(?:^|\.)feature\.tools\.modal\.name\.placeholder(?=$|:)/),
      {
        target: { value: 'Search' },
      },
    )
    fireEvent.change(
      screen.getByPlaceholderText(
        /(?:^|\.)feature\.tools\.modal\.variableName\.placeholder(?=$|:)/,
      ),
      {
        target: { value: 'search_api' },
      },
    )
    fireEvent.click(screen.getByText(/(?:^|\.)operation\.save(?=$|:)/))

    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringMatching(/(?:^|\.)errorMessage\.valueOfVarRequired(?=$|:)/),
    )
    expect(mockOnSave).not.toHaveBeenCalled()
  })

  it('should save api-based tools after selecting extension and emoji', async () => {
    mockOnValidateBeforeSave.mockReturnValue(true)

    render(
      <ExternalDataToolModal
        open
        data={{}}
        onOpenChange={mockOnCancel}
        onSave={mockOnSave}
        onValidateBeforeSave={mockOnValidateBeforeSave}
      />,
    )

    fireEvent.change(
      screen.getByPlaceholderText(/(?:^|\.)feature\.tools\.modal\.name\.placeholder(?=$|:)/),
      {
        target: { value: 'Search' },
      },
    )
    fireEvent.change(
      screen.getByPlaceholderText(
        /(?:^|\.)feature\.tools\.modal\.variableName\.placeholder(?=$|:)/,
      ),
      {
        target: { value: 'search_api' },
      },
    )
    fireEvent.click(screen.getByText('pick-extension'))
    fireEvent.click(screen.getByRole('button', { name: 'app.iconPicker.title' }))
    await waitFor(() => {
      expect(screen.getByPlaceholderText('app.iconPicker.search')).toBeInTheDocument()
    })
    const emojiButton = await screen.findByRole('gridcell', { name: 'Grinning face' })
    expect(emojiButton).toBeTruthy()
    fireEvent.click(emojiButton!)
    fireEvent.click(screen.getByRole('radio', { name: 'app.iconPicker.color.green' }))
    fireEvent.click(screen.getByRole('button', { name: /iconPicker\.ok/ }))
    expect(mockOnSave).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText(/(?:^|\.)operation\.save(?=$|:)/))

    await waitFor(() => {
      expect(mockOnValidateBeforeSave).toHaveBeenCalledWith(
        expect.objectContaining({
          config: {
            api_based_extension_id: 'extension-1',
          },
          enabled: true,
          icon: expect.any(String),
          icon_background: '#F3FEE7',
          label: 'Search',
          type: 'api',
          variable: 'search_api',
        }),
      )
    })

    expect(mockOnSave).toHaveBeenCalledWith(
      expect.objectContaining({
        config: {
          api_based_extension_id: 'extension-1',
        },
        enabled: true,
        icon: expect.any(String),
        icon_background: '#F3FEE7',
        label: 'Search',
        type: 'api',
        variable: 'search_api',
      }),
    )

    expect(
      screen.getByRole('link', { name: /(?:^|\.)apiBasedExtension\.link(?=$|:)/ }),
    ).toHaveAttribute(
      'href',
      'https://docs.example.com/use-dify/workspace/api-extension/api-extension',
    )
  })

  it('should save code-based tools with schema values and support cancel', async () => {
    render(
      <ExternalDataToolModal
        open
        data={{
          type: 'code-tool',
          enabled: false,
          config: {
            api_key: 'default-key',
          },
        }}
        onOpenChange={mockOnCancel}
        onSave={mockOnSave}
      />,
    )

    fireEvent.change(
      screen.getByPlaceholderText(/(?:^|\.)feature\.tools\.modal\.name\.placeholder(?=$|:)/),
      {
        target: { value: 'Code Search' },
      },
    )
    fireEvent.change(
      screen.getByPlaceholderText(
        /(?:^|\.)feature\.tools\.modal\.variableName\.placeholder(?=$|:)/,
      ),
      {
        target: { value: 'code_search' },
      },
    )
    fireEvent.click(screen.getByText('fill-form'))
    fireEvent.click(screen.getByText(/(?:^|\.)operation\.save(?=$|:)/))

    await waitFor(() => {
      expect(mockOnSave).toHaveBeenCalledWith(
        expect.objectContaining({
          config: {
            api_key: 'secret-key',
          },
          enabled: false,
          label: 'Code Search',
          type: 'code-tool',
          variable: 'code_search',
        }),
      )
    })

    fireEvent.click(screen.getByText(/(?:^|\.)operation\.cancel(?=$|:)/))
    expect(mockOnCancel).toHaveBeenCalled()
  })
})

mockEmojiData()

it('discards cancelled tool edits and submits a fresh session with Enter', async () => {
  const user = userEvent.setup()
  const data = {
    type: 'api',
    label: 'Original',
    variable: 'original',
    config: { api_based_extension_id: 'extension-1' },
  }
  const onOpenChange = vi.fn()
  const onSave = vi.fn()
  const view = render(
    <ExternalDataToolModal open data={data} onOpenChange={onOpenChange} onSave={onSave} />,
  )
  const name = screen.getByRole('textbox', { name: 'appDebug.feature.tools.modal.name.title' })
  await user.clear(name)
  await user.type(name, 'Discard')
  await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
  expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything())
  view.rerender(
    <ExternalDataToolModal open={false} data={data} onOpenChange={onOpenChange} onSave={onSave} />,
  )
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  view.rerender(
    <ExternalDataToolModal open data={data} onOpenChange={onOpenChange} onSave={onSave} />,
  )
  const freshName = screen.getByRole('textbox', { name: 'appDebug.feature.tools.modal.name.title' })
  expect(freshName).toHaveValue('Original')
  await user.clear(freshName)
  await user.type(freshName, 'Saved{Enter}')
  expect(onSave).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ label: 'Saved', variable: 'original' }),
  )
})
