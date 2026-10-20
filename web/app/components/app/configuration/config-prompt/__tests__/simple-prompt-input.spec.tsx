import type { ReactElement } from 'react'
import { act, render as rtlRender, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FeaturesContext } from '@/app/components/base/features/context'
import { createFeaturesStore } from '@/app/components/base/features/store'
import { replacePromptEditorText } from '@/app/components/base/prompt-editor/plugins/__tests__/test-helpers'
import ConfigContext from '@/context/debug-configuration'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import {
  createDebugConfigurationFixture,
  createModelConfigFixture,
} from '@/test/fixtures/debug-configuration'
import Prompt from '../simple-prompt-input'

const mockSetShowExternalDataToolModal = vi.fn()
const mockSetModelConfig = vi.fn()
const mockSetPrevPromptConfig = vi.fn()
const mockSetIntroduction = vi.fn()
const mockOnChange = vi.fn()
const mockToastError = vi.fn()

vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowExternalDataToolModal: mockSetShowExternalDataToolModal,
  }),
}))

vi.mock('@/app/components/app/configuration/toast', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

vi.mock('@/app/components/app/configuration/config/automatic/get-automatic-res', () => ({
  default: ({ onFinished }: { onFinished: (value: Record<string, unknown>) => void }) => (
    <button
      onClick={() =>
        onFinished({
          modified: 'auto prompt',
          variables: ['city'],
          opening_statement: 'hello there',
        })
      }
    >
      finish-automatic
    </button>
  ),
}))

let featuresStore: ReturnType<typeof createFeaturesStore>
const render = (ui: ReactElement) =>
  rtlRender(
    <EventEmitterContextProvider>
      <FeaturesContext.Provider value={featuresStore}>{ui}</FeaturesContext.Provider>
    </EventEmitterContextProvider>,
  )
const blurPrompt = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('textbox'))
  await user.tab()
}

const createContextValue = (
  overrides: Partial<ReturnType<typeof createDebugConfigurationFixture>> = {},
) =>
  createDebugConfigurationFixture({
    appId: 'app-1',
    modelConfig: createModelConfigFixture({
      configs: {
        prompt_template: 'Hello {{new_var}}',
        prompt_variables: [
          { key: 'existing_var', name: 'Existing', type: 'string', required: true },
        ],
      },
    }),
    dataSets: [],
    setModelConfig: mockSetModelConfig,
    setPrevPromptConfig: mockSetPrevPromptConfig,
    setIntroduction: mockSetIntroduction,
    hasSetBlockStatus: {
      context: false,
      history: false,
      query: false,
    },
    showSelectDataSet: vi.fn(),
    externalDataToolsConfig: [],
    ...overrides,
  })

describe('SimplePromptInput', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    featuresStore = createFeaturesStore()
  })

  it('should prompt to add new variables discovered from the prompt template', async () => {
    const user = userEvent.setup()
    render(
      <ConfigContext.Provider value={createContextValue()}>
        <Prompt
          mode={'chat'}
          promptTemplate="Hello {{new_var}}"
          promptVariables={[]}
          onChange={mockOnChange}
        />
      </ConfigContext.Provider>,
    )

    await blurPrompt(user)

    expect(screen.getByText(/(?:^|\.)autoAddVar(?=$|:)/))!.toBeInTheDocument()

    await user.click(screen.getByText(/(?:^|\.)operation\.add(?=$|:)/))

    expect(mockOnChange).toHaveBeenCalledWith('Hello {{new_var}}', [
      expect.objectContaining({
        key: 'new_var',
        name: 'new_var',
      }),
    ])
  })

  it('should open the external data tool modal and emit insert events after save', async () => {
    const user = userEvent.setup()
    render(
      <ConfigContext.Provider value={createContextValue()}>
        <Prompt
          mode={'chat'}
          promptTemplate="Hello"
          promptVariables={[
            { key: 'existing_var', name: 'Existing', type: 'string', required: true },
          ]}
          onChange={mockOnChange}
        />
      </ConfigContext.Provider>,
    )

    await user.click(screen.getByRole('textbox'))
    await replacePromptEditorText(screen.getByRole('textbox'), '/')
    await user.click(await screen.findByText('common.promptEditor.variable.modal.addTool'))

    expect(mockSetShowExternalDataToolModal).toHaveBeenCalledTimes(1)
    const modalConfig = mockSetShowExternalDataToolModal.mock.calls[0]![0]

    expect(modalConfig.onValidateBeforeSaveCallback({ variable: 'existing_var' })).toBe(false)
    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringMatching(/(?:^|\.)varKeyError\.keyAlreadyExists(?=$|:)/),
    )
    expect(modalConfig.onValidateBeforeSaveCallback({ variable: 'fresh_var' })).toBe(true)

    await act(async () => {
      modalConfig.onSaveCallback({ label: 'Search', variable: 'search_api' })
    })
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveTextContent('search_api'))
  })

  it('should apply automatic generation results to prompt and opening statement', async () => {
    const user = userEvent.setup()
    render(
      <ConfigContext.Provider value={createContextValue()}>
        <Prompt mode={'chat'} promptTemplate="Hello" promptVariables={[]} onChange={mockOnChange} />
      </ConfigContext.Provider>,
    )

    await user.click(screen.getByRole('button', { name: 'appDebug.operation.automatic' }))
    await user.click(screen.getByText('finish-automatic'))

    await waitFor(() => expect(screen.getByRole('textbox')).toHaveTextContent('auto prompt'))
    expect(mockSetModelConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        configs: expect.objectContaining({
          prompt_template: 'auto prompt',
          prompt_variables: [expect.objectContaining({ key: 'city', name: 'city' })],
        }),
      }),
    )
    expect(mockSetPrevPromptConfig).toHaveBeenCalledWith(
      expect.objectContaining({ prompt_template: 'Hello {{new_var}}' }),
    )
    expect(mockSetIntroduction).toHaveBeenCalledWith('hello there')
    expect(featuresStore.getState().features.opening).toEqual({
      enabled: true,
      opening_statement: 'hello there',
    })
  })

  it('should not ask to add known external tools or existing prompt variables', async () => {
    const user = userEvent.setup()
    render(
      <ConfigContext.Provider
        value={createContextValue({
          externalDataToolsConfig: [{ variable: 'search_api' }],
        })}
      >
        <Prompt
          mode={'chat'}
          promptTemplate="Hello {{search_api}} {{existing_var}}"
          promptVariables={[
            { key: 'existing_var', name: 'Existing', type: 'string', required: true },
          ]}
          onChange={mockOnChange}
        />
      </ConfigContext.Provider>,
    )

    await blurPrompt(user)
    expect(mockOnChange).toHaveBeenLastCalledWith('Hello {{search_api}} {{existing_var}}', [])
    expect(screen.queryByText(/(?:^|\.)autoAddVar(?=$|:)/)).not.toBeInTheDocument()
  })

  it('should keep invalid prompt variables in the confirmation flow', async () => {
    const user = userEvent.setup()
    render(
      <ConfigContext.Provider value={createContextValue()}>
        <Prompt
          mode={'chat'}
          promptTemplate="Hello {{existing_var}}"
          promptVariables={[{ key: 'existing_var', name: '', type: 'string', required: true }]}
          onChange={mockOnChange}
        />
      </ConfigContext.Provider>,
    )

    await blurPrompt(user)
    expect(screen.getByText(/(?:^|\.)autoAddVar(?=$|:)/))!.toBeInTheDocument()

    await user.click(screen.getByText(/(?:^|\.)operation\.cancel(?=$|:)/))
    expect(mockOnChange).toHaveBeenCalledWith('Hello {{existing_var}}', [])
  })
})
