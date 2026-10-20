import { RadioGroup } from '@langgenius/dify-ui/radio-group'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vite-plus/test'
import RadioCard from '../index'

type ExampleMode = 'standard' | 'advanced'

function RadioCardTypeExamples() {
  return (
    <RadioGroup<ExampleMode> value="standard" onValueChange={() => {}}>
      <RadioCard<ExampleMode>
        value="advanced"
        icon={<span>i</span>}
        title="Advanced"
        description="Typed option"
      />
      <RadioCard<ExampleMode>
        // @ts-expect-error RadioCard values should stay within the selected RadioGroup value type
        value="invalid"
        icon={<span>i</span>}
        title="Invalid"
        description="Invalid option"
      />
    </RadioGroup>
  )
}

void RadioCardTypeExamples

function SelectableCards() {
  const [value, setValue] = useState('standard')
  return (
    <RadioGroup aria-label="Options" value={value} onValueChange={setValue}>
      <RadioCard value="standard" icon={<span />} title="Standard" description="Standard mode" />
      <RadioCard
        value="advanced"
        icon={<span />}
        title="Advanced"
        description="Advanced mode"
        chosenConfig={<div>Advanced config</div>}
      />
    </RadioGroup>
  )
}

describe('RadioCard', () => {
  it('connects card selection to the controlled group', async () => {
    const user = userEvent.setup()
    render(<SelectableCards />)
    const advanced = screen.getByRole('radio', { name: /Advanced/ })
    expect(advanced).not.toBeChecked()
    await user.click(advanced)
    expect(advanced).toBeChecked()
    expect(screen.getByRole('radio', { name: /Standard/ })).not.toBeChecked()
  })

  it('should render noRadio card as static content without radio role', () => {
    render(
      <RadioCard
        noRadio
        icon={<span>i</span>}
        title="No Radio"
        description="desc"
        chosenConfig={<div>Static config</div>}
      />,
    )

    expect(screen.getByText('No Radio')).toBeInTheDocument()
    expect(screen.getByText('Static config')).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })
})
