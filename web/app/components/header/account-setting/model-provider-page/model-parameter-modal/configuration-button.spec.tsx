import type { ComponentProps } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { ConfigurationMethodEnum } from '../declarations'
import ConfigurationButton from './configuration-button'

describe('ConfigurationButton', () => {
  it('should render and handle click', () => {
    const handleOpenModal = vi.fn()
    const modelProvider = { id: 1 }

    render(
      <ConfigurationButton
        modelProvider={modelProvider as unknown as ComponentProps<typeof ConfigurationButton>['modelProvider']}
        handleOpenModal={handleOpenModal}
      />,
    )

    const button = screen.getByRole('button')
    fireEvent.click(button)

    expect(handleOpenModal).toHaveBeenCalledWith(
      modelProvider,
      ConfigurationMethodEnum.predefinedModel,
      undefined,
    )
  })
})
