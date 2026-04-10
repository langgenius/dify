import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import HasNotSetAPI from '../has-not-set-api'

describe('HasNotSetAPI', () => {
  it('should render the empty state copy', () => {
    render(<HasNotSetAPI onSetting={vi.fn()} />)

    expect(screen.getByText('appDebug.noModelProviderConfigured')).toBeInTheDocument()
    expect(screen.getByText('appDebug.noModelProviderConfiguredTip')).toBeInTheDocument()
  })

  it('should call onSetting when manage models button is clicked', () => {
    const onSetting = vi.fn()
    render(<HasNotSetAPI onSetting={onSetting} />)

    fireEvent.click(screen.getByRole('button', { name: 'appDebug.manageModels' }))
    expect(onSetting).toHaveBeenCalledTimes(1)
  })
})
