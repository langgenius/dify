import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FolderPlusIcon, NotionIcon, ThreeDotsIcon } from './icons'

describe('Icons', () => {
  describe('FolderPlusIcon', () => {
    it('should render without crashing', () => {
      render(<FolderPlusIcon />)
      const svg = document.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('should have correct dimensions', () => {
      render(<FolderPlusIcon />)
      const svg = document.querySelector('svg')
      expect(svg).toHaveAttribute('width', '20')
      expect(svg).toHaveAttribute('height', '20')
    })

    it('should apply custom className', () => {
      render(<FolderPlusIcon className="custom-class" />)
      const svg = document.querySelector('svg')
      expect(svg).toHaveClass('custom-class')
    })

    it('should have empty className by default', () => {
      render(<FolderPlusIcon />)
      const svg = document.querySelector('svg')
      expect(svg).toHaveAttribute('class', '')
    })
  })

  describe('ThreeDotsIcon', () => {
    it('should render without crashing', () => {
      const { container } = render(<ThreeDotsIcon />)
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('should have correct dimensions', () => {
      const { container } = render(<ThreeDotsIcon />)
      const svg = container.querySelector('svg')
      expect(svg).toHaveAttribute('width', '16')
      expect(svg).toHaveAttribute('height', '16')
    })

    it('should apply custom className', () => {
      const { container } = render(<ThreeDotsIcon className="custom-class" />)
      const svg = container.querySelector('svg')
      expect(svg).toHaveClass('custom-class')
    })
  })

  describe('NotionIcon', () => {
    it('should render without crashing', () => {
      const { container } = render(<NotionIcon />)
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('should have correct dimensions', () => {
      const { container } = render(<NotionIcon />)
      const svg = container.querySelector('svg')
      expect(svg).toHaveAttribute('width', '20')
      expect(svg).toHaveAttribute('height', '20')
    })

    it('should apply custom className', () => {
      const { container } = render(<NotionIcon className="custom-class" />)
      const svg = container.querySelector('svg')
      expect(svg).toHaveClass('custom-class')
    })

    it('should contain clipPath definition', () => {
      const { container } = render(<NotionIcon />)
      const clipPath = container.querySelector('clipPath')
      expect(clipPath).toBeInTheDocument()
      expect(clipPath).toHaveAttribute('id', 'clip0_2164_11263')
    })
  })
})
