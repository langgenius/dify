import { RadioGroup } from '@langgenius/dify-ui/radio'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
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
      {/* @ts-expect-error RadioCard values should stay within the selected RadioGroup value type */}
      <RadioCard<ExampleMode> value="invalid" icon={<span>i</span>} title="Invalid" description="Invalid option" />
    </RadioGroup>
  )
}

void RadioCardTypeExamples

function renderSelectableCard({
  selected = false,
  onValueChange = vi.fn(),
}: {
  selected?: boolean
  onValueChange?: (value: string) => void
} = {}) {
  render(
    <RadioGroup
      aria-label="Options"
      value={selected ? 'card' : undefined}
      onValueChange={onValueChange}
    >
      <RadioCard
        value="card"
        icon={<span data-testid="icon">ICON</span>}
        title="Card Title"
        description="Some description"
        chosenConfig={<div>Config</div>}
      />
    </RadioGroup>,
  )

  return {
    radio: screen.getByRole('radio', { name: /Card Title/ }),
    onValueChange,
  }
}

describe('RadioCard', () => {
  it('should render selectable card content and expose radio semantics', () => {
    const { radio } = renderSelectableCard()

    expect(screen.getByTestId('icon')).toBeInTheDocument()
    expect(screen.getByText('Card Title')).toBeInTheDocument()
    expect(screen.getByText('Some description')).toBeInTheDocument()
    expect(radio).toHaveAttribute('aria-checked', 'false')
  })

  it('should emit RadioGroup value change when selected', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    const { radio } = renderSelectableCard({ onValueChange })

    await user.click(radio)

    expect(onValueChange).toHaveBeenCalledWith('card', expect.any(Object))
  })

  it('should show selected styles and configuration when checked', () => {
    const { radio } = renderSelectableCard({ selected: true })

    expect(radio).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('Config')).toBeInTheDocument()
    expect(radio.parentElement).toHaveClass('has-[[data-checked]]:border-[1.5px]')
    expect(radio.parentElement).toHaveClass('has-[[data-checked]]:bg-components-option-card-option-selected-bg')
  })

  it('should apply custom className to the card root and config wrapper', () => {
    render(
      <RadioGroup aria-label="Options" value="card">
        <RadioCard
          value="card"
          icon={<span>i</span>}
          title="Custom"
          description="desc"
          className="my-root-class"
          chosenConfig={<div>cfg</div>}
          chosenConfigWrapClassName="my-config-wrap"
        />
      </RadioGroup>,
    )

    const radio = screen.getByRole('radio', { name: /Custom/ })
    expect(radio.parentElement).toHaveClass('my-root-class')
    expect(screen.getByText('cfg').parentElement).toHaveClass('my-config-wrap')
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
