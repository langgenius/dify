import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { toast } from '@/app/components/app/configuration/toast'
import Result from '../result'
import { GeneratorType } from '../types'

const mockCopy = vi.fn()
vi.mock('copy-to-clipboard', () => ({ default: (text: string) => mockCopy(text) }))
vi.mock('@/app/components/app/configuration/toast', () => ({ toast: { success: vi.fn() } }))
vi.mock('@/app/components/workflow/nodes/_base/hooks/use-available-var-list', () => ({
  default: () => ({ availableVars: [], availableNodes: [] }),
}))
vi.mock(
  '@/app/components/workflow/nodes/llm/components/json-schema-config-modal/code-editor',
  () => ({
    default: ({ value, readOnly }: { value: string; readOnly: boolean }) => (
      <textarea aria-label="Generated code" value={value} readOnly={readOnly} />
    ),
  }),
)

const versions = [
  { modified: 'First output', message: 'First note' },
  { modified: 'Second output', message: 'Second note' },
]

it('switches generated versions, copies the selected output and confirms before applying it', async () => {
  const user = userEvent.setup()
  const onApply = vi.fn()
  function Results() {
    const [index, setIndex] = useState(0)
    return (
      <Result
        isBasicMode
        generatorType={GeneratorType.prompt}
        current={versions[index]!}
        currentVersionIndex={index}
        setCurrentVersionIndex={setIndex}
        versions={versions}
        onApply={onApply}
      />
    )
  }
  render(<Results />)
  expect(screen.getByText('First output')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /generate\.version 1$/ }))
  await user.click(screen.getByRole('menuitemradio', { name: /generate\.version 2/ }))
  await screen.findByText('Second output')
  expect(await screen.findByText('Second note')).toBeInTheDocument()
  expect(screen.queryByText('First output')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.copy' }))
  expect(mockCopy).toHaveBeenCalledWith('Second output')
  expect(toast.success).toHaveBeenCalledWith('common.actionMsg.copySuccessfully')
  await user.click(screen.getByRole('button', { name: /generate\.apply$/ }))
  expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  expect(onApply).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(onApply).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: /generate\.apply$/ }))
  await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
  expect(onApply).toHaveBeenCalledOnce()
})

it.each([GeneratorType.prompt, GeneratorType.code])(
  'shows %s output in the corresponding read-only editor',
  (generatorType) => {
    render(
      <Result
        nodeId="node-1"
        generatorType={generatorType}
        current={versions[0]!}
        currentVersionIndex={0}
        setCurrentVersionIndex={vi.fn()}
        versions={versions}
        onApply={vi.fn()}
      />,
    )
    if (generatorType === GeneratorType.code) {
      expect(screen.getByRole('textbox', { name: 'Generated code' })).toHaveValue('First output')
      expect(screen.getByRole('textbox', { name: 'Generated code' })).toHaveAttribute('readonly')
    } else {
      expect(screen.getByText('First output')).toBeInTheDocument()
      expect(screen.getByRole('textbox')).toHaveAttribute('contenteditable', 'false')
    }
  },
)
