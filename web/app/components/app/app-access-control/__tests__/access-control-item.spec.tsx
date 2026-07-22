import { RadioGroup } from '@langgenius/dify-ui/radio'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { AccessMode } from '@/models/access-control'
import AccessControlItem from '../access-control-item'

describe('AccessControlItem', () => {
  function AccessOptions({ initialValue = AccessMode.PUBLIC }: { initialValue?: AccessMode }) {
    const [value, setValue] = useState<AccessMode>(initialValue)

    return (
      <RadioGroup<AccessMode> aria-label="Access" value={value} onValueChange={setValue}>
        <AccessControlItem type={AccessMode.ORGANIZATION}>Organization Only</AccessControlItem>
        <AccessControlItem type={AccessMode.PUBLIC}>Anyone</AccessControlItem>
      </RadioGroup>
    )
  }

  it('should expose a single-select radio group and update the checked option', async () => {
    const user = userEvent.setup()
    render(<AccessOptions />)

    const organization = screen.getByRole('radio', { name: 'Organization Only' })
    const anyone = screen.getByRole('radio', { name: 'Anyone' })

    expect(screen.getByRole('radiogroup', { name: 'Access' })).toBeInTheDocument()
    expect(organization).not.toBeChecked()
    expect(anyone).toBeChecked()

    await user.click(organization)

    expect(organization).toBeChecked()
    expect(anyone).not.toBeChecked()
  })

  it('should support arrow-key selection between options', async () => {
    const user = userEvent.setup()
    render(<AccessOptions initialValue={AccessMode.ORGANIZATION} />)

    const organization = screen.getByRole('radio', { name: 'Organization Only' })
    const anyone = screen.getByRole('radio', { name: 'Anyone' })
    expect(organization).toBeChecked()
    organization.focus()

    await user.keyboard('{ArrowRight}')

    expect(anyone).toBeChecked()
  })

  it('should not select a disabled option', async () => {
    const user = userEvent.setup()
    render(
      <RadioGroup<AccessMode> aria-label="Access" defaultValue={AccessMode.PUBLIC}>
        <AccessControlItem type={AccessMode.ORGANIZATION} disabled>
          Organization Only
        </AccessControlItem>
        <AccessControlItem type={AccessMode.PUBLIC}>Anyone</AccessControlItem>
      </RadioGroup>,
    )

    const organization = screen.getByRole('radio', { name: 'Organization Only' })
    expect(organization).toHaveAttribute('aria-disabled', 'true')
    expect(organization).toHaveClass('cursor-not-allowed')

    await user.click(organization)

    expect(organization).not.toBeChecked()
    expect(screen.getByRole('radio', { name: 'Anyone' })).toBeChecked()
  })
})
