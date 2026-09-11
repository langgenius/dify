import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import ConditionNumber from '../condition-number'

function NumericCondition({ onChange }: { onChange: (value?: string | number) => void }) {
  const [value, setValue] = useState<string | number | undefined>(0)
  return (
    <ConditionNumber
      value={value}
      onChange={(nextValue) => {
        setValue(nextValue)
        onChange(nextValue)
      }}
      valueMethod="constant"
      onValueMethodChange={vi.fn()}
      nodesOutputVars={[]}
      availableNodes={[]}
      commonVariables={[]}
    />
  )
}

describe('numeric metadata condition', () => {
  it('preserves signed decimal precision and clears without producing zero', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<NumericCondition onChange={onChange} />)
    const input = screen.getByRole('textbox', {
      name: 'workflow.nodes.knowledgeRetrieval.metadata.panel.placeholder',
    })
    expect(input).toHaveValue('0')
    await user.clear(input)
    await user.type(input, '-7.123456')
    await user.tab()
    expect(input).toHaveValue('-7.123456')
    expect(onChange).toHaveBeenLastCalledWith(-7.123456)
    await user.clear(input)
    await user.tab()
    expect(input).toHaveValue('')
    expect(onChange).toHaveBeenLastCalledWith(undefined)
  })
})
