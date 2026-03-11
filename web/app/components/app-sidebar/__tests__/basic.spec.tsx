import { render, screen } from '@testing-library/react'
import * as React from 'react'
import AppBasic from '../basic'

vi.mock('@/app/components/base/icons/src/vender/workflow', () => ({
  ApiAggregate: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="api-icon" {...props} />,
  WindowCursor: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="webapp-icon" {...props} />,
}))

vi.mock('@/app/components/base/tooltip', () => ({
  default: ({ popupContent }: { popupContent: React.ReactNode }) => (
    <div data-testid="tooltip">{popupContent}</div>
  ),
}))

vi.mock('../../base/app-icon', () => ({
  default: ({ icon, background, innerIcon, className }: {
    icon?: string
    background?: string
    innerIcon?: React.ReactNode
    className?: string
  }) => (
    <div data-testid="app-icon" data-icon={icon} data-bg={background} className={className}>
      {innerIcon}
    </div>
  ),
}))

describe('AppBasic', () => {
  describe('Icon rendering', () => {
    it('should render app icon when iconType is app with valid icon and background', () => {
      render(<AppBasic name="Test" type="Chat" icon="🤖" icon_background="#fff" />)
      expect(screen.getByTestId('app-icon')).toBeInTheDocument()
    })

    it('should not render app icon when icon is empty', () => {
      render(<AppBasic name="Test" type="Chat" />)
      expect(screen.queryByTestId('app-icon')).not.toBeInTheDocument()
    })

    it('should render api icon when iconType is api', () => {
      render(<AppBasic name="Test" type="API" iconType="api" />)
      expect(screen.getByTestId('api-icon')).toBeInTheDocument()
    })

    it('should render webapp icon when iconType is webapp', () => {
      render(<AppBasic name="Test" type="Webapp" iconType="webapp" />)
      expect(screen.getByTestId('webapp-icon')).toBeInTheDocument()
    })

    it('should render dataset icon when iconType is dataset', () => {
      render(<AppBasic name="Test" type="Dataset" iconType="dataset" />)
      const icons = screen.getAllByTestId('app-icon')
      expect(icons.length).toBeGreaterThan(0)
    })

    it('should render notion icon when iconType is notion', () => {
      render(<AppBasic name="Test" type="Notion" iconType="notion" />)
      const icons = screen.getAllByTestId('app-icon')
      expect(icons.length).toBeGreaterThan(0)
    })
  })

  describe('Expand mode', () => {
    it('should show name and type in expand mode', () => {
      render(<AppBasic name="My App" type="Chatbot" />)
      expect(screen.getByText('My App')).toBeInTheDocument()
      expect(screen.getByText('Chatbot')).toBeInTheDocument()
    })

    it('should hide name and type in collapse mode', () => {
      render(<AppBasic name="My App" type="Chatbot" mode="collapse" />)
      expect(screen.queryByText('My App')).not.toBeInTheDocument()
    })

    it('should show hover tip when provided', () => {
      render(<AppBasic name="My App" type="Chatbot" hoverTip="Some tip" />)
      expect(screen.getByTestId('tooltip')).toBeInTheDocument()
      expect(screen.getByText('Some tip')).toBeInTheDocument()
    })

    it('should not show hover tip when not provided', () => {
      render(<AppBasic name="My App" type="Chatbot" />)
      expect(screen.queryByTestId('tooltip')).not.toBeInTheDocument()
    })
  })

  describe('Type display', () => {
    it('should hide type when hideType is true', () => {
      render(<AppBasic name="My App" type="Chatbot" hideType />)
      expect(screen.queryByText('Chatbot')).not.toBeInTheDocument()
    })

    it('should show external tag when isExternal is true', () => {
      render(<AppBasic name="My App" type="Dataset" isExternal />)
      expect(screen.getByText('dataset.externalTag')).toBeInTheDocument()
    })

    it('should show type inline when isExtraInLine is true and hideType is false', () => {
      render(<AppBasic name="My App" type="Chatbot" isExtraInLine />)
      expect(screen.getByText('Chatbot')).toBeInTheDocument()
    })

    it('should apply custom text styles', () => {
      render(<AppBasic name="My App" type="Chatbot" textStyle={{ main: 'text-red-500' }} />)
      const nameContainer = screen.getByText('My App').parentElement
      expect(nameContainer).toHaveClass('text-red-500')
    })
  })
})
