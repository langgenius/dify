import { Popover } from '@langgenius/dify-ui/popover'
import { render, screen } from '@testing-library/react'
import { ModelSettingsTrigger } from '../model-settings-trigger'

describe('ModelSettingsTrigger', () => {
  it('should compose the popover behavior onto the final icon button', () => {
    render(
      <Popover>
        <ModelSettingsTrigger />
      </Popover>,
    )

    const trigger = screen.getByRole('button', {
      name: 'common.modelProvider.modelSettings',
    })

    expect(trigger.querySelector('button')).not.toBeInTheDocument()
  })

  it('should put the disabled state on the final icon button', () => {
    render(
      <Popover>
        <ModelSettingsTrigger disabled />
      </Popover>,
    )

    expect(
      screen.getByRole('button', { name: 'common.modelProvider.modelSettings' }),
    ).toBeDisabled()
  })
})
