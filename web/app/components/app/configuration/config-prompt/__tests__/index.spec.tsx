import type { IPromptProps } from '../index'
import type { PromptItem, PromptVariable } from '@/models/debug'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { replacePromptEditorText } from '@/app/components/base/prompt-editor/plugins/__tests__/test-helpers'
import { MAX_PROMPT_MESSAGE_LENGTH } from '@/config'
import ConfigContext from '@/context/debug-configuration'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { PromptRole } from '@/models/debug'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { createDebugConfigurationFixture } from '@/test/fixtures/debug-configuration'
import { ModelModeType } from '@/types/app'
import Prompt from '../index'

type DebugConfiguration = ReturnType<typeof createDebugConfigurationFixture>

const defaultPromptVariables: PromptVariable[] = [
  { key: 'var', name: 'Variable', type: 'string', required: true },
]

vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({ setShowExternalDataToolModal: vi.fn() }),
}))

const getContextValue = (overrides: Partial<DebugConfiguration> = {}): DebugConfiguration => {
  return createDebugConfigurationFixture({
    setCurrentAdvancedPrompt: vi.fn(),
    isAdvancedMode: false,
    currentAdvancedPrompt: [],
    modelModeType: ModelModeType.chat,
    dataSets: [],
    hasSetBlockStatus: {
      context: false,
      history: false,
      query: false,
    },
    ...overrides,
  })
}

const renderComponent = (
  props: Partial<IPromptProps> = {},
  contextOverrides: Partial<DebugConfiguration> = {},
) => {
  const mergedProps: IPromptProps = {
    mode: 'chat' as const,
    promptTemplate: 'initial template',
    promptVariables: defaultPromptVariables,
    onChange: vi.fn(),
    ...props,
  }
  const contextValue = getContextValue(contextOverrides)

  return {
    contextValue,
    ...render(
      <EventEmitterContextProvider>
        <ConfigContext.Provider value={contextValue}>
          <Prompt {...mergedProps} />
        </ConfigContext.Provider>
      </EventEmitterContextProvider>,
    ),
  }
}

describe('Prompt config component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render advanced chat prompts and show context missing tip when dataset context is not set', async () => {
    const user = userEvent.setup()
    const currentAdvancedPrompt: PromptItem[] = [
      { role: PromptRole.user, text: 'first' },
      { role: PromptRole.assistant, text: 'second' },
    ]
    renderComponent(
      {},
      {
        isAdvancedMode: true,
        currentAdvancedPrompt,
        modelModeType: ModelModeType.chat,
        dataSets: [createDatasetFixture({ id: 'ds' })],
        hasSetBlockStatus: { context: false, history: true, query: true },
      },
    )

    expect(screen.getAllByRole('textbox')).toHaveLength(2)
    expect(screen.getAllByText('appDebug.promptMode.contextMissing')).toHaveLength(2)
    await user.click(screen.getAllByRole('button', { name: 'common.operation.ok' })[0]!)
    expect(screen.queryByText('appDebug.promptMode.contextMissing')).not.toBeInTheDocument()
  })

  it('should update chat prompt value and call setter with user change flag', async () => {
    const currentAdvancedPrompt: PromptItem[] = [
      { role: PromptRole.user, text: 'first' },
      { role: PromptRole.assistant, text: 'second' },
    ]
    const setCurrentAdvancedPrompt = vi.fn()
    renderComponent(
      {},
      {
        isAdvancedMode: true,
        currentAdvancedPrompt,
        modelModeType: ModelModeType.chat,
        setCurrentAdvancedPrompt,
      },
    )

    const editor = screen.getAllByRole('textbox')[0]!
    await replacePromptEditorText(editor, 'updated text')
    await waitFor(() =>
      expect(setCurrentAdvancedPrompt).toHaveBeenLastCalledWith(
        [
          { role: PromptRole.user, text: 'updated text' },
          { role: PromptRole.assistant, text: 'second' },
        ],
        true,
      ),
    )
  })

  it('should update chat prompt role when type changes', async () => {
    const user = userEvent.setup()
    const currentAdvancedPrompt: PromptItem[] = [
      { role: PromptRole.user, text: 'first' },
      { role: PromptRole.user, text: 'second' },
    ]
    const setCurrentAdvancedPrompt = vi.fn()
    renderComponent(
      {},
      {
        isAdvancedMode: true,
        currentAdvancedPrompt,
        modelModeType: ModelModeType.chat,
        setCurrentAdvancedPrompt,
      },
    )

    await user.click(screen.getAllByText('user')[1]!)
    await user.click(screen.getByText('assistant'))
    expect(setCurrentAdvancedPrompt).toHaveBeenCalledWith([
      { role: PromptRole.user, text: 'first' },
      { role: PromptRole.assistant, text: 'second' },
    ])
  })

  it('should delete chat prompt item', async () => {
    const user = userEvent.setup()
    const currentAdvancedPrompt: PromptItem[] = [
      { role: PromptRole.user, text: 'first' },
      { role: PromptRole.assistant, text: 'second' },
    ]
    const setCurrentAdvancedPrompt = vi.fn()
    renderComponent(
      {},
      {
        isAdvancedMode: true,
        currentAdvancedPrompt,
        modelModeType: ModelModeType.chat,
        setCurrentAdvancedPrompt,
      },
    )

    // The production delete control is an SVG without an accessible name.
    await user.click(document.querySelector<SVGElement>('svg.cursor-pointer')!)
    expect(setCurrentAdvancedPrompt).toHaveBeenCalledWith([
      { role: PromptRole.assistant, text: 'second' },
    ])
  })

  it('should append a mirrored role message when clicking add in chat mode', async () => {
    const user = userEvent.setup()
    const currentAdvancedPrompt: PromptItem[] = [{ role: PromptRole.user, text: 'first' }]
    const setCurrentAdvancedPrompt = vi.fn()
    renderComponent(
      {},
      {
        isAdvancedMode: true,
        currentAdvancedPrompt,
        modelModeType: ModelModeType.chat,
        setCurrentAdvancedPrompt,
      },
    )

    await user.click(
      screen.getByRole('button', { name: 'appDebug.promptMode.operation.addMessage' }),
    )
    expect(setCurrentAdvancedPrompt).toHaveBeenCalledWith([
      { role: PromptRole.user, text: 'first' },
      { role: PromptRole.assistant, text: '' },
    ])
  })

  it('should append a user role when the last chat prompt is from assistant', async () => {
    const user = userEvent.setup()
    const currentAdvancedPrompt: PromptItem[] = [{ role: PromptRole.assistant, text: 'reply' }]
    const setCurrentAdvancedPrompt = vi.fn()
    renderComponent(
      {},
      {
        isAdvancedMode: true,
        currentAdvancedPrompt,
        modelModeType: ModelModeType.chat,
        setCurrentAdvancedPrompt,
      },
    )

    await user.click(
      screen.getByRole('button', { name: 'appDebug.promptMode.operation.addMessage' }),
    )
    expect(setCurrentAdvancedPrompt).toHaveBeenCalledWith([
      { role: PromptRole.assistant, text: 'reply' },
      { role: PromptRole.user, text: '' },
    ])
  })

  it('should insert a system message when adding to an empty chat prompt list', async () => {
    const user = userEvent.setup()
    const setCurrentAdvancedPrompt = vi.fn()
    renderComponent(
      {},
      {
        isAdvancedMode: true,
        currentAdvancedPrompt: [],
        modelModeType: ModelModeType.chat,
        setCurrentAdvancedPrompt,
      },
    )

    await user.click(
      screen.getByRole('button', { name: 'appDebug.promptMode.operation.addMessage' }),
    )
    expect(setCurrentAdvancedPrompt).toHaveBeenCalledWith([{ role: PromptRole.system, text: '' }])
  })

  it('should not show add button when reaching max prompt length', () => {
    const prompts: PromptItem[] = Array.from({ length: MAX_PROMPT_MESSAGE_LENGTH }, (_, index) => ({
      role: PromptRole.user,
      text: `item-${index}`,
    }))
    renderComponent(
      {},
      {
        isAdvancedMode: true,
        currentAdvancedPrompt: prompts,
        modelModeType: ModelModeType.chat,
      },
    )

    expect(screen.queryByText('appDebug.promptMode.operation.addMessage')).toBeNull()
  })

  it('should update completion prompt value and flag as user change', async () => {
    const setCurrentAdvancedPrompt = vi.fn()
    renderComponent(
      {},
      {
        isAdvancedMode: true,
        currentAdvancedPrompt: { role: PromptRole.user, text: 'single' },
        modelModeType: ModelModeType.completion,
        setCurrentAdvancedPrompt,
      },
    )

    const editor = screen.getByRole('textbox')
    await replacePromptEditorText(editor, 'updated text')

    await waitFor(() =>
      expect(setCurrentAdvancedPrompt).toHaveBeenLastCalledWith(
        { role: PromptRole.user, text: 'updated text' },
        true,
      ),
    )
  })
})
