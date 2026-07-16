import type { ReactElement, ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { MissingReferenceWarning } from '../missing-reference-warning'

vi.mock('@langgenius/dify-ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div role="tooltip">{children}</div>,
  TooltipTrigger: ({ render }: { render: ReactElement }) => render,
}))

describe('MissingReferenceWarning', () => {
  it('should render a warning icon with matching accessible and tooltip labels', () => {
    render(<MissingReferenceWarning label="File not found" />)

    const warning = screen.getByRole('button', { name: 'File not found' })
    expect(warning.querySelector('.i-ri-alert-fill')).toBeInTheDocument()
    expect(screen.getByRole('tooltip')).toHaveTextContent('File not found')
  })
})
