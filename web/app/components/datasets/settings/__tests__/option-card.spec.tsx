import { RadioGroup } from '@langgenius/dify-ui/radio-group'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OptionCard from '../option-card'

describe('OptionCard disabled focus', () => {
  it.each(['item', 'group'] as const)(
    'skips a selected radio disabled by the %s',
    async (source) => {
      const user = userEvent.setup()
      const onValueChange = vi.fn()
      render(
        <>
          <button type="button">Before</button>
          <RadioGroup value="general" disabled={source === 'group'} onValueChange={onValueChange}>
            <OptionCard
              id="general"
              title="General"
              description="Current chunk structure"
              disabled={source === 'item'}
            />
          </RadioGroup>
          <button type="button">After</button>
        </>,
      )

      const radio = screen.getByRole('radio', { name: 'General' })
      expect(radio).toBeDisabled()
      expect(radio).toBeChecked()
      expect(radio).toHaveAccessibleDescription('Current chunk structure')
      await user.tab()
      expect(screen.getByRole('button', { name: 'Before' })).toHaveFocus()
      await user.tab()
      expect(screen.getByRole('button', { name: 'After' })).toHaveFocus()
      await user.click(radio)
      expect(radio).not.toHaveFocus()
      expect(onValueChange).not.toHaveBeenCalled()
    },
  )

  it('skips disabled options when navigating an enabled group with arrows', async () => {
    const user = userEvent.setup()
    render(
      <RadioGroup defaultValue="first">
        <OptionCard id="first" title="First" />
        <OptionCard id="disabled" title="Unavailable" disabled />
        <OptionCard id="last" title="Last" />
      </RadioGroup>,
    )
    await user.tab()
    expect(screen.getByRole('radio', { name: 'First' })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('radio', { name: 'Last' })).toHaveFocus()
    expect(screen.getByRole('radio', { name: 'Last' })).toBeChecked()
  })
})
