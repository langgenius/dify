import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { mockEmojiData } from '@/test/emoji-picker'
import ExternalDataToolModal from '../external-data-tool-modal'

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

vi.mock('@/app/components/base/app-icon', () => ({
  default: ({ onClick }: { onClick: () => void }) => (
    <button onClick={onClick}>open-emoji-picker</button>
  ),
}))

vi.mock('@/app/components/base/features/new-feature-panel/moderation/form-generation', () => ({
  default: ({ onChange }: { onChange: (value: Record<string, string>) => void }) => (
    <button onClick={() => onChange({ api_key: 'secret-key' })}>fill-form</button>
  ),
}))

vi.mock('@/app/components/header/account-setting/api-based-extension-page/selector', () => ({
  ApiBasedExtensionSelector: ({
    onChange,
    value,
  }: {
    onChange: (value: string) => void
    value: string
  }) => <button onClick={() => onChange('extension-1')}>{value || 'pick-extension'}</button>,
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
    render(<ExternalDataToolModal data={{}} onCancel={mockOnCancel} onSave={mockOnSave} />)

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
        data={{}}
        onCancel={mockOnCancel}
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
    fireEvent.click(screen.getByText('open-emoji-picker'))
    await waitFor(() => {
      expect(screen.getByPlaceholderText('app.iconPicker.search')).toBeInTheDocument()
    })
    const emojiButton = await screen.findByRole('gridcell', { name: 'Grinning face' })
    expect(emojiButton).toBeTruthy()
    fireEvent.click(emojiButton!)
    fireEvent.click(screen.getByRole('button', { name: '#F3FEE7' }))
    fireEvent.click(screen.getByRole('button', { name: /iconPicker\.ok/ }))
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
        data={{
          type: 'code-tool',
          enabled: false,
          config: {
            api_key: 'default-key',
          },
        }}
        onCancel={mockOnCancel}
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
