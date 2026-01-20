import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import CreateAppCard from './index'

describe('CreateAppCard', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<CreateAppCard />)
      expect(screen.getAllByRole('link')).toHaveLength(3)
    })

    it('should render create dataset option', () => {
      render(<CreateAppCard />)
      expect(screen.getByText(/createDataset/)).toBeInTheDocument()
    })

    it('should render create from pipeline option', () => {
      render(<CreateAppCard />)
      expect(screen.getByText(/createFromPipeline/)).toBeInTheDocument()
    })

    it('should render connect dataset option', () => {
      render(<CreateAppCard />)
      expect(screen.getByText(/connectDataset/)).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should have correct displayName', () => {
      expect(CreateAppCard.displayName).toBe('CreateAppCard')
    })
  })

  describe('Links', () => {
    it('should have correct href for create dataset', () => {
      render(<CreateAppCard />)
      const links = screen.getAllByRole('link')
      expect(links[0]).toHaveAttribute('href', '/datasets/create')
    })

    it('should have correct href for create from pipeline', () => {
      render(<CreateAppCard />)
      const links = screen.getAllByRole('link')
      expect(links[1]).toHaveAttribute('href', '/datasets/create-from-pipeline')
    })

    it('should have correct href for connect dataset', () => {
      render(<CreateAppCard />)
      const links = screen.getAllByRole('link')
      expect(links[2]).toHaveAttribute('href', '/datasets/connect')
    })
  })

  describe('Styles', () => {
    it('should have correct card styling', () => {
      const { container } = render(<CreateAppCard />)
      const card = container.firstChild as HTMLElement
      expect(card).toHaveClass('h-[190px]', 'flex', 'flex-col', 'rounded-xl')
    })

    it('should have border separator for connect option', () => {
      const { container } = render(<CreateAppCard />)
      const borderDiv = container.querySelector('.border-t-\\[0\\.5px\\]')
      expect(borderDiv).toBeInTheDocument()
    })
  })

  describe('Icons', () => {
    it('should render three icons for three options', () => {
      const { container } = render(<CreateAppCard />)
      // Each option has an icon
      const icons = container.querySelectorAll('svg')
      expect(icons.length).toBeGreaterThanOrEqual(3)
    })
  })
})
