import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import EmptyFolder from './empty-folder'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

describe('EmptyFolder', () => {
  it('should render empty folder message', () => {
    render(<EmptyFolder />)
    expect(screen.getByText('onlineDrive.emptyFolder')).toBeInTheDocument()
  })
})
