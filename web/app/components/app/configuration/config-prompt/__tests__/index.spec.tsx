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

const getContextValue = (overrides: Partial<DebugConfiguration> = {}): DebugConfiguration => {
  return createDebugConfigurationFixture({
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
    ...props,
  }
  const contextValue = getContextValue(contextOverrides)

  function ControlledPrompt() {
    const [prompt, setPrompt] = React.useState(contextValue.currentAdvancedPrompt)
    return (
      <EventEmitterContextProvider>
        <ConfigContext.Provider
          value={{
            ...contextValue,
            currentAdvancedPrompt: prompt,
            setCurrentAdvancedPrompt: setPrompt,
          }}
        >
          <Prompt {...mergedProps} />
          <output aria-label="Configured prompt">{JSON.stringify(prompt)}</output>
        </ConfigContext.Provider>
      </EventEmitterContextProvider>
    )
  }
  return render(<ControlledPrompt />)
}

const configuredPrompt = (): DebugConfiguration['currentAdvancedPrompt'] =>
  JSON.parse(screen.getByLabelText('Configured prompt').textContent!)

describe('Prompt config component', () => {
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

  it('persists edited chat text while preserving the other message', async () => {
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
      },
    )

    const editor = screen.getAllByRole('textbox')[0]!
    await replacePromptEditorText(editor, 'updated text')
    await waitFor(() =>
      expect(configuredPrompt()).toEqual([
        { role: PromptRole.user, text: 'updated text' },
        { role: PromptRole.assistant, text: 'second' },
      ]),
    )
  })

  it('should update chat prompt role when type changes', async () => {
    const user = userEvent.setup()
    const currentAdvancedPrompt: PromptItem[] = [
      { role: PromptRole.user, text: 'first' },
      { role: PromptRole.user, text: 'second' },
    ]
    renderComponent(
      {},
      {
        isAdvancedMode: true,
        currentAdvancedPrompt,
        modelModeType: ModelModeType.chat,
      },
    )

    await user.click(screen.getAllByText('user')[1]!)
    await user.click(screen.getByText('assistant'))
    expect(screen.getByText('assistant')).toBeInTheDocument()
    expect(screen.getByText('user')).toBeInTheDocument()
    expect(configuredPrompt()).toEqual([
      { role: PromptRole.user, text: 'first' },
      { role: PromptRole.assistant, text: 'second' },
    ])
  })

  it('should append a mirrored role message when clicking add in chat mode', async () => {
    const user = userEvent.setup()
    const currentAdvancedPrompt: PromptItem[] = [{ role: PromptRole.user, text: 'first' }]
    renderComponent(
      {},
      {
        isAdvancedMode: true,
        currentAdvancedPrompt,
        modelModeType: ModelModeType.chat,
      },
    )

    await user.click(
      screen.getByRole('button', { name: 'appDebug.promptMode.operation.addMessage' }),
    )
    expect(configuredPrompt()).toEqual([
      { role: PromptRole.user, text: 'first' },
      { role: PromptRole.assistant, text: '' },
    ])
  })

  it('should append a user role when the last chat prompt is from assistant', async () => {
    const user = userEvent.setup()
    const currentAdvancedPrompt: PromptItem[] = [{ role: PromptRole.assistant, text: 'reply' }]
    renderComponent(
      {},
      {
        isAdvancedMode: true,
        currentAdvancedPrompt,
        modelModeType: ModelModeType.chat,
      },
    )

    await user.click(
      screen.getByRole('button', { name: 'appDebug.promptMode.operation.addMessage' }),
    )
    expect(configuredPrompt()).toEqual([
      { role: PromptRole.assistant, text: 'reply' },
      { role: PromptRole.user, text: '' },
    ])
  })

  it('should insert a system message when adding to an empty chat prompt list', async () => {
    const user = userEvent.setup()
    renderComponent(
      {},
      {
        isAdvancedMode: true,
        currentAdvancedPrompt: [],
        modelModeType: ModelModeType.chat,
      },
    )

    await user.click(
      screen.getByRole('button', { name: 'appDebug.promptMode.operation.addMessage' }),
    )
    expect(configuredPrompt()).toEqual([{ role: PromptRole.system, text: '' }])
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

  it('persists edited completion prompt text', async () => {
    renderComponent(
      {},
      {
        isAdvancedMode: true,
        currentAdvancedPrompt: { role: PromptRole.user, text: 'single' },
        modelModeType: ModelModeType.completion,
      },
    )

    const editor = screen.getByRole('textbox')
    await replacePromptEditorText(editor, 'updated text')

    await waitFor(() =>
      expect(configuredPrompt()).toEqual({ role: PromptRole.user, text: 'updated text' }),
    )
  })
})
