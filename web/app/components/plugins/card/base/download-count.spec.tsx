import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import DownloadCount from './download-count'

vi.mock('@remixicon/react', () => ({
  RiInstallLine: () => <span data-testid="install-icon" />,
}))

vi.mock('@/utils/format', () => ({
  formatNumber: (n: number) => {
    if (n >= 1000)
      return `${(n / 1000).toFixed(1)}k`
    return String(n)
  },
}))

describe('DownloadCount', () => {
  it('renders formatted download count', () => {
    render(<DownloadCount downloadCount={1500} />)
    expect(screen.getByText('1.5k')).toBeInTheDocument()
  })

  it('renders small numbers directly', () => {
    render(<DownloadCount downloadCount={42} />)
    expect(screen.getByText('42')).toBeInTheDocument()
  })

  it('renders install icon', () => {
    render(<DownloadCount downloadCount={100} />)
    expect(screen.getByTestId('install-icon')).toBeInTheDocument()
  })

  it('renders zero download count', () => {
    render(<DownloadCount downloadCount={0} />)
    expect(screen.getByText('0')).toBeInTheDocument()
  })
})
