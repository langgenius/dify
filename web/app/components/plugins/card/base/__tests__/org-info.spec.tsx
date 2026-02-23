import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import OrgInfo from '../org-info'

describe('OrgInfo', () => {
  it('renders package name', () => {
    render(<OrgInfo packageName="my-plugin" />)
    expect(screen.getByText('my-plugin')).toBeInTheDocument()
  })

  it('renders org name with separator when provided', () => {
    render(<OrgInfo orgName="dify" packageName="search-tool" />)
    expect(screen.getByText('dify')).toBeInTheDocument()
    expect(screen.getByText('/')).toBeInTheDocument()
    expect(screen.getByText('search-tool')).toBeInTheDocument()
  })

  it('does not render org name or separator when orgName is not provided', () => {
    render(<OrgInfo packageName="standalone" />)
    expect(screen.queryByText('/')).not.toBeInTheDocument()
    expect(screen.getByText('standalone')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    const { container } = render(<OrgInfo packageName="pkg" className="custom-class" />)
    expect((container.firstChild as HTMLElement).className).toContain('custom-class')
  })

  it('applies packageNameClassName to package name element', () => {
    render(<OrgInfo packageName="pkg" packageNameClassName="w-auto" />)
    const pkgEl = screen.getByText('pkg')
    expect(pkgEl.className).toContain('w-auto')
  })
})
