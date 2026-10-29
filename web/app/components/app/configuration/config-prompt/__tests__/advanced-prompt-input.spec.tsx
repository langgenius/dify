import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { replacePromptEditorText } from '@/app/components/base/prompt-editor/plugins/__tests__/test-helpers'
import ConfigContext from '@/context/debug-configuration'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { PromptRole } from '@/models/debug'
import {
  createDebugConfigurationFixture,
  createModelConfigFixture,
} from '@/test/fixtures/debug-configuration'
import AdvancedPromptInput from '../advanced-prompt-input'

const copy = vi.fn()
vi.mock('copy-to-clipboard', () => ({ default: (...args: unknown[]) => copy(...args) }))
vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({ setShowExternalDataToolModal: vi.fn() }),
}))

function renderPrompt(initialValue = 'Hello') {
  const onChange = vi.fn()
  const onTypeChange = vi.fn()
  const onDelete = vi.fn()
  const setModelConfig = vi.fn()
  const modelConfig = createModelConfigFixture({
    configs: {
      prompt_template: '',
      prompt_variables: [{ key: 'existing_var', name: 'Existing', type: 'string', required: true }],
    },
  })
  function ControlledPrompt() {
    const [value, setValue] = useState(initialValue)
    const [type, setType] = useState<PromptRole>(PromptRole.user)
    return (
      <EventEmitterContextProvider>
        <ConfigContext.Provider
          value={createDebugConfigurationFixture({
            modelConfig,
            setModelConfig,
            externalDataToolsConfig: [],
            dataSets: [],
          })}
        >
          <AdvancedPromptInput
            value={value}
            type={type}
            isChatMode
            canDelete
            onChange={(next) => {
              setValue(next)
              onChange(next)
            }}
            onTypeChange={(next) => {
              setType(next)
              onTypeChange(next)
            }}
            onDelete={onDelete}
            promptVariables={modelConfig.configs.prompt_variables}
            isContextMissing={false}
            onHideContextMissingTip={vi.fn()}
          />
        </ConfigContext.Provider>
      </EventEmitterContextProvider>
    )
  }
  return { ...render(<ControlledPrompt />), onChange, onTypeChange, onDelete, setModelConfig }
}

beforeEach(() => vi.clearAllMocks())

it('edits the prompt and role, copies the current text once, and deletes the segment', async () => {
  const user = userEvent.setup()
  const { container, onChange, onTypeChange, onDelete } = renderPrompt()
  const editor = screen.getByRole('textbox')
  await replacePromptEditorText(editor, 'Hello world')
  await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('Hello world'))
  await user.click(screen.getByText('user'))
  await user.click(screen.getByText('assistant'))
  expect(onTypeChange).toHaveBeenCalledWith(PromptRole.assistant)
  const copyButton = screen.getByRole('button', { name: 'common.operation.copy' })
  await user.click(copyButton)
  await user.keyboard('{Enter} ')
  expect(copy).toHaveBeenCalledExactlyOnceWith('Hello world')
  // The delete icon currently has no accessible button role.
  await user.click(container.querySelector<SVGElement>('svg.cursor-pointer')!)
  expect(onDelete).toHaveBeenCalledTimes(1)
})

it('asks to add newly discovered variables when the actual editor loses focus', async () => {
  const user = userEvent.setup()
  const { setModelConfig } = renderPrompt('Hello {{new_var}}')
  await user.click(screen.getByRole('textbox'))
  await user.tab()
  const add = await screen.findByRole('button', { name: /operation\.add$/ })
  expect(setModelConfig).not.toHaveBeenCalled()
  await user.click(add)
  expect(setModelConfig).toHaveBeenCalledWith(
    expect.objectContaining({
      configs: expect.objectContaining({
        prompt_variables: [
          expect.objectContaining({ key: 'existing_var' }),
          expect.objectContaining({ key: 'new_var', name: 'new_var' }),
        ],
      }),
    }),
  )
})
