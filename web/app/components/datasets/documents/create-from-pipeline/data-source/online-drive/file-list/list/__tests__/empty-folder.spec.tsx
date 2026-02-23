import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import EmptyFolder from '../empty-folder'

describe('EmptyFolder', () => {
  it('should render empty folder message', () => {
    render(<EmptyFolder />)
    expect(screen.getByText('datasetPipeline.onlineDrive.emptyFolder')).toBeInTheDocument()
  })
})
