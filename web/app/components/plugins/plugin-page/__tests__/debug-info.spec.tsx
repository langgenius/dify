import type { DebugInfo as DebugInfoType } from '../../types'
import { render, screen } from '@testing-library/react'
import * as React from 'react'

import DebugInfo from '../debug-info'

const { mockUseDebugKey } = vi.hoisted(() => ({
  mockUseDebugKey: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.com${path}`,
}))

vi.mock('@/service/use-plugins', () => ({
  useDebugKey: () => mockUseDebugKey(),
}))

vi.mock('@/app/components/base/button', () => ({
  default: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => React.createElement('button', props, children),
}))

vi.mock('@/app/components/base/tooltip', () => ({
  default: ({
    children,
    popupContent,
    disabled,
  }: {
    children: React.ReactNode
    popupContent: React.ReactNode
    disabled?: boolean
  }) => (
    <div data-testid="tooltip" data-disabled={String(Boolean(disabled))}>
      {children}
      {!disabled && <div data-testid="tooltip-content">{popupContent}</div>}
    </div>
  ),
}))

vi.mock('../../base/key-value-item', () => ({
  default: ({
    label,
    value,
    maskedValue,
  }: {
    label: string
    value: string
    maskedValue?: string
  }) => (
    <div data-testid={`key-value-${label}`}>
      <span>{label}</span>
      <span>{value}</span>
      {maskedValue && <span>{maskedValue}</span>}
    </div>
  ),
}))

describe('DebugInfo', () => {
  const debugInfo: DebugInfoType = {
    host: '127.0.0.1',
    port: 8765,
    key: '12345678abcdefgh87654321',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render nothing while loading', () => {
    mockUseDebugKey.mockReturnValue({
      data: undefined,
      isLoading: true,
    })

    const { container } = render(<DebugInfo />)

    expect(container.firstChild).toBeNull()
  })

  it('should render a disabled tooltip when debug info is unavailable', () => {
    mockUseDebugKey.mockReturnValue({
      data: undefined,
      isLoading: false,
    })

    render(<DebugInfo />)

    expect(screen.getByTestId('tooltip')).toHaveAttribute('data-disabled', 'true')
    expect(screen.queryByTestId('tooltip-content')).not.toBeInTheDocument()
  })

  it('should render masked debug information and docs link when data is available', () => {
    mockUseDebugKey.mockReturnValue({
      data: debugInfo,
      isLoading: false,
    })

    render(<DebugInfo />)

    expect(screen.getAllByTestId('tooltip')[0]).toHaveAttribute('data-disabled', 'false')
    expect(screen.getByText('debugInfo.title')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'debugInfo.viewDocs' })).toHaveAttribute(
      'href',
      'https://docs.example.com/develop-plugin/features-and-specs/plugin-types/remote-debug-a-plugin',
    )
    expect(screen.getByTestId('key-value-URL')).toHaveTextContent('127.0.0.1:8765')
    expect(screen.getByTestId('key-value-Key')).toHaveTextContent('12345678abcdefgh87654321')
    expect(screen.getByTestId('key-value-Key')).toHaveTextContent('12345678********87654321')
  })
})
