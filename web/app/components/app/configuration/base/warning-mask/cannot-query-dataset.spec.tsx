import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import CannotQueryDataset from './cannot-query-dataset'

describe('CannotQueryDataset WarningMask', () => {
  it('should render dataset warning copy and action button', () => {
    const onConfirm = vi.fn()
    render(<CannotQueryDataset onConfirm={onConfirm} />)

    expect(screen.getByText('appDebug.feature.dataSet.queryVariable.unableToQueryDataSet')).toBeInTheDocument()
    expect(screen.getByText('appDebug.feature.dataSet.queryVariable.unableToQueryDataSetTip')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'appDebug.feature.dataSet.queryVariable.ok' })).toBeInTheDocument()
  })

  it('should invoke onConfirm when OK button clicked', () => {
    const onConfirm = vi.fn()
    render(<CannotQueryDataset onConfirm={onConfirm} />)

    fireEvent.click(screen.getByRole('button', { name: 'appDebug.feature.dataSet.queryVariable.ok' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})
