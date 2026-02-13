import type { IAppBasicProps } from '../components/basic'
import { render, screen } from '@testing-library/react'
import AppBasic from '../components/basic'

const baseProps: IAppBasicProps = {
  name: 'My App',
  type: 'Chatbot',
  icon: '🤖',
  icon_background: '#FFEAD5',
}

describe('AppBasic', () => {
  describe('expand mode (default)', () => {
    it('should render name and type', () => {
      render(<AppBasic {...baseProps} />)
      expect(screen.getByText('My App')).toBeInTheDocument()
      expect(screen.getByText('Chatbot')).toBeInTheDocument()
    })

    it('should hide type when hideType is true', () => {
      render(<AppBasic {...baseProps} hideType />)
      expect(screen.getByText('My App')).toBeInTheDocument()
      expect(screen.queryByText('Chatbot')).not.toBeInTheDocument()
    })

    it('should render type inline when isExtraInLine', () => {
      render(<AppBasic {...baseProps} isExtraInLine />)
      const el = screen.getByText('Chatbot')
      expect(el).toHaveClass('flex')
    })

    it('should show external tag when isExternal', () => {
      render(<AppBasic {...baseProps} isExternal />)
      expect(screen.getByText('dataset.externalTag')).toBeInTheDocument()
    })

    it('should apply custom textStyle.main', () => {
      render(<AppBasic {...baseProps} textStyle={{ main: 'custom-main' }} />)
      const nameRow = screen.getByText('My App').closest('.flex.flex-row')
      expect(nameRow).toHaveClass('custom-main')
    })

    it('should render tooltip trigger when hoverTip is provided', () => {
      const { container } = render(<AppBasic {...baseProps} hoverTip="Tip text" />)
      expect(container.querySelector('[class*="ml-1"]')).toBeInTheDocument()
    })
  })

  describe('collapse mode', () => {
    it('should not render name or type text', () => {
      render(<AppBasic {...baseProps} mode="collapse" />)
      expect(screen.queryByText('My App')).not.toBeInTheDocument()
      expect(screen.queryByText('Chatbot')).not.toBeInTheDocument()
    })
  })

  describe('icon types', () => {
    it('should render app icon when iconType=app with icon & background', () => {
      const { container } = render(<AppBasic {...baseProps} iconType="app" />)
      expect(container.querySelector('.mr-2')).toBeInTheDocument()
    })

    it('should not render app icon when icon or background is missing', () => {
      const { container } = render(<AppBasic name="X" type="T" iconType="app" />)
      expect(container.querySelectorAll('.mr-2')).toHaveLength(0)
    })

    it('should render api icon', () => {
      const { container } = render(<AppBasic name="X" type="T" iconType="api" />)
      expect(container.querySelector('.mr-2')).toBeInTheDocument()
    })

    it('should render dataset icon', () => {
      const { container } = render(<AppBasic name="X" type="T" iconType="dataset" />)
      expect(container.querySelector('.mr-2')).toBeInTheDocument()
    })

    it('should render webapp icon', () => {
      const { container } = render(<AppBasic name="X" type="T" iconType="webapp" />)
      expect(container.querySelector('.mr-2')).toBeInTheDocument()
    })

    it('should render notion icon', () => {
      const { container } = render(<AppBasic name="X" type="T" iconType="notion" />)
      expect(container.querySelector('.mr-2')).toBeInTheDocument()
    })
  })
})
