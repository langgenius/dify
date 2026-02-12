/**
 * Integration test: RunOnce form lifecycle
 *
 * Tests the complete user journey:
 *   Init defaults → edit fields → submit → running state → stop
 */
import type { InputValueTypes } from '@/app/components/share/text-generation/types'
import type { PromptConfig, PromptVariable } from '@/models/debug'
import type { SiteInfo } from '@/models/share'
import type { VisionSettings } from '@/types/app'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { useRef, useState } from 'react'
import RunOnce from '@/app/components/share/text-generation/run-once'
import { Resolution, TransferMethod } from '@/types/app'

vi.mock('@/hooks/use-breakpoints', () => ({
  default: vi.fn(() => 'pc'),
  MediaType: { pc: 'pc', pad: 'pad', mobile: 'mobile' },
}))

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: ({ value, onChange }: { value?: string, onChange?: (val: string) => void }) => (
    <textarea data-testid="code-editor" value={value ?? ''} onChange={e => onChange?.(e.target.value)} />
  ),
}))

vi.mock('@/app/components/base/image-uploader/text-generation-image-uploader', () => ({
  default: () => <div data-testid="vision-uploader" />,
}))

vi.mock('@/app/components/base/file-uploader', () => ({
  FileUploaderInAttachmentWrapper: () => <div data-testid="file-uploader" />,
}))

// ----- helpers -----

const variable = (overrides: Partial<PromptVariable>): PromptVariable => ({
  key: 'k',
  name: 'Name',
  type: 'string',
  required: true,
  ...overrides,
})

const visionOff: VisionSettings = {
  enabled: false,
  number_limits: 0,
  detail: Resolution.low,
  transfer_methods: [TransferMethod.local_file],
  image_file_size_limit: 5,
}

const siteInfo: SiteInfo = { title: 'Test' }

/**
 * Stateful wrapper that mirrors what text-generation/index.tsx does:
 * owns `inputs` state and passes an `inputsRef`.
 */
function Harness({
  promptConfig,
  visionConfig = visionOff,
  onSendSpy,
  runControl = null,
}: {
  promptConfig: PromptConfig
  visionConfig?: VisionSettings
  onSendSpy: () => void
  runControl?: React.ComponentProps<typeof RunOnce>['runControl']
}) {
  const [inputs, setInputs] = useState<Record<string, InputValueTypes>>({})
  const inputsRef = useRef<Record<string, InputValueTypes>>({})

  return (
    <RunOnce
      siteInfo={siteInfo}
      promptConfig={promptConfig}
      inputs={inputs}
      inputsRef={inputsRef}
      onInputsChange={(updated) => {
        inputsRef.current = updated
        setInputs(updated)
      }}
      onSend={onSendSpy}
      visionConfig={visionConfig}
      onVisionFilesChange={vi.fn()}
      runControl={runControl}
    />
  )
}

// ----- tests -----

describe('RunOnce – integration flow', () => {
  it('full lifecycle: init → edit → submit → running → stop', async () => {
    const onSend = vi.fn()

    const config: PromptConfig = {
      prompt_template: 'tpl',
      prompt_variables: [
        variable({ key: 'name', name: 'Name', type: 'string', default: '' }),
        variable({ key: 'age', name: 'Age', type: 'number', default: '' }),
        variable({ key: 'bio', name: 'Bio', type: 'paragraph', default: '' }),
      ],
    }

    // Phase 1 – render, wait for initialisation
    const { rerender } = render(
      <Harness promptConfig={config} onSendSpy={onSend} />,
    )

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Name')).toBeInTheDocument()
    })

    // Phase 2 – fill fields
    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'Alice' } })
    fireEvent.change(screen.getByPlaceholderText('Age'), { target: { value: '30' } })
    fireEvent.change(screen.getByPlaceholderText('Bio'), { target: { value: 'Hello' } })

    // Phase 3 – submit
    fireEvent.click(screen.getByTestId('run-button'))
    expect(onSend).toHaveBeenCalledTimes(1)

    // Phase 4 – simulate "running" state
    const onStop = vi.fn()
    rerender(
      <Harness
        promptConfig={config}
        onSendSpy={onSend}
        runControl={{ onStop, isStopping: false }}
      />,
    )

    const stopBtn = screen.getByTestId('stop-button')
    expect(stopBtn).toBeInTheDocument()
    fireEvent.click(stopBtn)
    expect(onStop).toHaveBeenCalledTimes(1)

    // Phase 5 – simulate "stopping" state
    rerender(
      <Harness
        promptConfig={config}
        onSendSpy={onSend}
        runControl={{ onStop, isStopping: true }}
      />,
    )
    expect(screen.getByTestId('stop-button')).toBeDisabled()
  })

  it('clear resets all field types and allows re-submit', async () => {
    const onSend = vi.fn()

    const config: PromptConfig = {
      prompt_template: 'tpl',
      prompt_variables: [
        variable({ key: 'q', name: 'Question', type: 'string', default: 'Hi' }),
        variable({ key: 'flag', name: 'Flag', type: 'checkbox' }),
      ],
    }

    render(<Harness promptConfig={config} onSendSpy={onSend} />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Question')).toHaveValue('Hi')
    })

    // Clear all
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.clear' }))

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Question')).toHaveValue('')
    })

    // Re-fill and submit
    fireEvent.change(screen.getByPlaceholderText('Question'), { target: { value: 'New' } })
    fireEvent.click(screen.getByTestId('run-button'))
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('mixed input types: string + select + json_object', async () => {
    const onSend = vi.fn()

    const config: PromptConfig = {
      prompt_template: 'tpl',
      prompt_variables: [
        variable({ key: 'txt', name: 'Text', type: 'string', default: '' }),
        variable({
          key: 'sel',
          name: 'Dropdown',
          type: 'select',
          options: ['A', 'B'],
          default: 'A',
        }),
        variable({
          key: 'json',
          name: 'JSON',
          type: 'json_object' as PromptVariable['type'],
        }),
      ],
    }

    render(<Harness promptConfig={config} onSendSpy={onSend} />)

    await waitFor(() => {
      expect(screen.getByText('Text')).toBeInTheDocument()
      expect(screen.getByText('Dropdown')).toBeInTheDocument()
      expect(screen.getByText('JSON')).toBeInTheDocument()
    })

    // Edit text & json
    fireEvent.change(screen.getByPlaceholderText('Text'), { target: { value: 'hello' } })
    fireEvent.change(screen.getByTestId('code-editor'), { target: { value: '{"a":1}' } })

    fireEvent.click(screen.getByTestId('run-button'))
    expect(onSend).toHaveBeenCalledTimes(1)
  })
})
