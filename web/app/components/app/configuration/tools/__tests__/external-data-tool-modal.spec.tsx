import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockEmojiData, renderWithEmoji as render } from '@/test/emoji-picker'
import ExternalDataToolModal from '../external-data-tool-modal'

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'codeBasedExtension.get': () =>
        Promise.resolve({
          module: 'external_data_tool',
          data: [
            {
              name: 'code-tool',
              label: { 'en-US': 'Code Provider', 'zh-Hans': '代码提供方' },
              form_schema: [
                {
                  variable: 'api_key',
                  default: 'default-key',
                  required: true,
                  type: 'text-input',
                  placeholder: '',
                  options: [],
                  label: { 'en-US': 'API Key', 'zh-Hans': '接口密钥' },
                },
              ],
            },
          ],
        }),
    }),
  }
})

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

  it('should require an API extension before saving api-based tools', async () => {
    const user = userEvent.setup()
    render(<ExternalDataToolModal data={{}} onCancel={mockOnCancel} onSave={mockOnSave} />)

    await user.type(
      screen.getByPlaceholderText(/(?:^|\.)feature\.tools\.modal\.name\.placeholder(?=$|:)/),
      'Search',
    )
    await user.type(
      screen.getByPlaceholderText(
        /(?:^|\.)feature\.tools\.modal\.variableName\.placeholder(?=$|:)/,
      ),
      'search_api',
    )
    await user.click(screen.getByText(/(?:^|\.)operation\.save(?=$|:)/))

    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringMatching(/(?:^|\.)errorMessage\.valueOfVarRequired(?=$|:)/),
    )
    expect(mockOnSave).not.toHaveBeenCalled()
  })

  it('should save api-based tools after selecting extension and emoji', async () => {
    const user = userEvent.setup()
    mockOnValidateBeforeSave.mockReturnValue(true)

    render(
      <ExternalDataToolModal
        data={{}}
        onCancel={mockOnCancel}
        onSave={mockOnSave}
        onValidateBeforeSave={mockOnValidateBeforeSave}
      />,
    )

    await user.type(
      screen.getByPlaceholderText(/(?:^|\.)feature\.tools\.modal\.name\.placeholder(?=$|:)/),
      'Search',
    )
    await user.type(
      screen.getByPlaceholderText(
        /(?:^|\.)feature\.tools\.modal\.variableName\.placeholder(?=$|:)/,
      ),
      'search_api',
    )
    await user.click(screen.getByText('pick-extension'))
    await user.click(screen.getByRole('button', { name: 'app.iconPicker.title' }))
    await waitFor(() => {
      expect(screen.getByPlaceholderText('app.iconPicker.search')).toBeInTheDocument()
    })
    const emojiButton = await screen.findByRole('gridcell', { name: 'Grinning face' })
    await user.click(emojiButton!)
    await user.click(screen.getByRole('radio', { name: 'app.iconPicker.color.green' }))
    await user.click(screen.getByRole('button', { name: /iconPicker\.ok/ }))
    await user.click(screen.getByText(/(?:^|\.)operation\.save(?=$|:)/))

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
    const user = userEvent.setup()
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

    await user.type(
      screen.getByPlaceholderText(/(?:^|\.)feature\.tools\.modal\.name\.placeholder(?=$|:)/),
      'Code Search',
    )
    await user.type(
      screen.getByPlaceholderText(
        /(?:^|\.)feature\.tools\.modal\.variableName\.placeholder(?=$|:)/,
      ),
      'code_search',
    )
    const apiKey = await screen.findByRole('textbox', { name: 'API Key' })
    await user.clear(apiKey)
    await user.type(apiKey, 'secret-key')
    await user.click(screen.getByText(/(?:^|\.)operation\.save(?=$|:)/))

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

    await user.click(screen.getByText(/(?:^|\.)operation\.cancel(?=$|:)/))
    expect(mockOnCancel).toHaveBeenCalled()
  })
})

mockEmojiData()
