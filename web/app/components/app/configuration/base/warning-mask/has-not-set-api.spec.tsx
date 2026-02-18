import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import HasNotSetAPI from './has-not-set-api'

describe('HasNotSetAPI WarningMask', () => {
  it('should show default title when trial not finished', () => {
    render(<HasNotSetAPI isTrailFinished={false} onSetting={vi.fn()} />)

    expect(screen.getByText('appDebug.notSetAPIKey.title')).toBeInTheDocument()
    expect(screen.getByText('appDebug.notSetAPIKey.description')).toBeInTheDocument()
  })

  it('should show trail finished title when flag is true', () => {
    render(<HasNotSetAPI isTrailFinished onSetting={vi.fn()} />)

    expect(screen.getByText('appDebug.notSetAPIKey.trailFinished')).toBeInTheDocument()
  })

  it('should call onSetting when primary button clicked', () => {
    const onSetting = vi.fn()
    render(<HasNotSetAPI isTrailFinished={false} onSetting={onSetting} />)

    fireEvent.click(screen.getByRole('button', { name: 'appDebug.notSetAPIKey.settingBtn' }))
    expect(onSetting).toHaveBeenCalledTimes(1)
  })
})
