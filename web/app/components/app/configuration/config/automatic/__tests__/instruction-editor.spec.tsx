import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import InstructionEditor from '../instruction-editor'
import { GeneratorType } from '../types'

const mockEmit = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: {
      emit: (...args: unknown[]) => mockEmit(...args),
    },
  }),
}))

vi.mock('@/app/components/base/prompt-editor', () => ({
  default: (props: {
    onChange: (value: string) => void
    placeholder: ReactNode
    currentBlock: { show: boolean }
    errorMessageBlock: { show: boolean }
    lastRunBlock: { show: boolean }
  }) => (
    <div>
      <div data-testid="prompt-placeholder">{props.placeholder}</div>
      <div data-testid="current-block">{String(props.currentBlock.show)}</div>
      <div data-testid="error-block">{String(props.errorMessageBlock.show)}</div>
      <div data-testid="last-run-block">{String(props.lastRunBlock.show)}</div>
      <button onClick={() => props.onChange('updated instruction')}>change-instruction</button>
    </div>
  ),
}))

describe('InstructionEditor', () => {
  const baseProps = {
    editorKey: 'editor-1',
    value: 'hello',
    onChange: vi.fn(),
    availableVars: [],
    availableNodes: [],
    isShowCurrentBlock: true,
    isShowLastRunBlock: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the prompt placeholder and forward text changes', () => {
    render(
      <InstructionEditor
        {...baseProps}
        generatorType={GeneratorType.prompt}
      />,
    )

    expect(screen.getByText('generate.instructionPlaceHolderTitle')).toBeInTheDocument()
    expect(screen.getByTestId('current-block')).toHaveTextContent('true')
    expect(screen.getByTestId('error-block')).toHaveTextContent('false')

    fireEvent.click(screen.getByText('change-instruction'))

    expect(baseProps.onChange).toHaveBeenCalledWith('updated instruction')
  })

  it('should render the code placeholder and emit quick insert events', () => {
    render(
      <InstructionEditor
        {...baseProps}
        generatorType={GeneratorType.code}
        isShowLastRunBlock
      />,
    )

    expect(screen.getByText('generate.codeGenInstructionPlaceHolderLine')).toBeInTheDocument()
    expect(screen.getByTestId('error-block')).toHaveTextContent('true')
    expect(screen.getByTestId('last-run-block')).toHaveTextContent('true')

    fireEvent.click(screen.getByRole('button', { name: 'generate.insertContext' }))

    expect(mockEmit).toHaveBeenCalledWith(expect.objectContaining({
      instanceId: 'editor-1',
    }))
  })
})
