import { RadioGroup } from '@langgenius/dify-ui/radio-group'
import { useState } from 'react'
import { describe, expect, it } from 'vite-plus/test'
import { page as screen, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
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
  beforeEach(async () => {
    await screen.viewport(800, 600)
  })
  it('connects card selection to the controlled group', async () => {
    await render(<SelectableCards />)
    const advanced = screen.getByRole('radio', { name: /Advanced/ })
    await expect.element(advanced).not.toBeChecked()
    await expect.element(screen.getByText('Advanced config')).not.toBeVisible()
    await advanced.click()
    await expect.element(advanced).toBeChecked()
    await expect.element(screen.getByText('Advanced config')).toBeVisible()
    await expect.element(screen.getByRole('radio', { name: /Standard/ })).not.toBeChecked()
    await userEvent.keyboard('{ArrowLeft}')
    await expect.element(screen.getByRole('radio', { name: /Standard/ })).toBeChecked()
    await expect.element(screen.getByText('Advanced config')).not.toBeVisible()
  })

  it('should render noRadio card as static content without radio role', async () => {
    await render(
      <RadioCard
        noRadio
        icon={<span>i</span>}
        title="No Radio"
        description="desc"
        chosenConfig={<div>Static config</div>}
      />,
    )

    await expect.element(screen.getByText('No Radio')).toBeInTheDocument()
    await expect.element(screen.getByText('Static config')).toBeInTheDocument()
    await expect.element(screen.getByRole('radio')).not.toBeInTheDocument()
  })
})
