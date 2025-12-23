import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import HasNotSetAPI from './has-not-set-api'

describe('HasNotSetAPI WarningMask', () => {
  test('should show default title when trial not finished', () => {
    render(<HasNotSetAPI isTrailFinished={false} onSetting={vi.fn()} />)

    expect(screen.getByText('appDebug.notSetAPIKey.title')).toBeInTheDocument()
    expect(screen.getByText('appDebug.notSetAPIKey.description')).toBeInTheDocument()
  })

  test('should show trail finished title when flag is true', () => {
    render(<HasNotSetAPI isTrailFinished onSetting={vi.fn()} />)

    expect(screen.getByText('appDebug.notSetAPIKey.trailFinished')).toBeInTheDocument()
  })

  test('should call onSetting when primary button clicked', () => {
    const onSetting = vi.fn()
    render(<HasNotSetAPI isTrailFinished={false} onSetting={onSetting} />)

    fireEvent.click(screen.getByRole('button', { name: 'appDebug.notSetAPIKey.settingBtn' }))
    expect(onSetting).toHaveBeenCalledTimes(1)
  })
})
