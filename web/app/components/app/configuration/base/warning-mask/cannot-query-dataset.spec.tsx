import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import CannotQueryDataset from './cannot-query-dataset'

describe('CannotQueryDataset WarningMask', () => {
  test('should render dataset warning copy and action button', () => {
    const onConfirm = vi.fn()
    render(<CannotQueryDataset onConfirm={onConfirm} />)

    expect(screen.getByText('appDebug.feature.dataSet.queryVariable.unableToQueryDataSet')).toBeInTheDocument()
    expect(screen.getByText('appDebug.feature.dataSet.queryVariable.unableToQueryDataSetTip')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'appDebug.feature.dataSet.queryVariable.ok' })).toBeInTheDocument()
  })

  test('should invoke onConfirm when OK button clicked', () => {
    const onConfirm = vi.fn()
    render(<CannotQueryDataset onConfirm={onConfirm} />)

    fireEvent.click(screen.getByRole('button', { name: 'appDebug.feature.dataSet.queryVariable.ok' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})
