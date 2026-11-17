import { Popover, PopoverContent } from '@langgenius/dify-ui/popover'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModelSettingsTrigger } from '../model-settings-trigger'

it('opens model settings through the composed trigger unless disabled', async () => {
  const user = userEvent.setup()
  const view = (disabled: boolean) => (
    <Popover>
      <ModelSettingsTrigger disabled={disabled} />
      <PopoverContent>Model parameters</PopoverContent>
    </Popover>
  )
  const { rerender } = render(view(true))
  const trigger = screen.getByRole('button', {
    name: 'modelProvider.modelProvider.modelSettings',
  })
  await user.click(trigger)
  expect(screen.queryByText('Model parameters')).not.toBeInTheDocument()

  rerender(view(false))
  await user.click(trigger)
  expect(await screen.findByText('Model parameters')).toBeVisible()
})
