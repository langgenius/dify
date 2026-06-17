import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import NewDatasetCard from '../index'
import Option from '../option'

describe('New Dataset Card Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Integration tests for Option component
  describe('Option', () => {
    describe('Rendering', () => {
      it('should render a link with text and icon', () => {
        render(<Option iconClassName="i-ri-add-line" text="Create" href="/create" />)
        const link = screen.getByRole('link')
        expect(link).toBeInTheDocument()
        expect(screen.getByText('Create')).toBeInTheDocument()
      })

      it('should render icon with correct sizing class', () => {
        const { container } = render(<Option iconClassName="i-ri-add-line" text="Test" href="/test" />)
        const icon = container.querySelector('.size-4')
        expect(icon).toBeInTheDocument()
      })
    })

    describe('Props', () => {
      it('should set correct href on the link', () => {
        render(<Option iconClassName="i-ri-add-line" text="Go" href="/datasets/create" />)
        const link = screen.getByRole('link')
        expect(link).toHaveAttribute('href', '/datasets/create')
      })

      it('should render different text based on props', () => {
        render(<Option iconClassName="i-ri-add-line" text="Custom Text" href="/path" />)
        expect(screen.getByText('Custom Text')).toBeInTheDocument()
      })

      it('should render different href based on props', () => {
        render(<Option iconClassName="i-ri-add-line" text="Link" href="/custom-path" />)
        const link = screen.getByRole('link')
        expect(link).toHaveAttribute('href', '/custom-path')
      })
    })

    describe('Styles', () => {
      it('should have correct link styling', () => {
        render(<Option iconClassName="i-ri-add-line" text="Styled" href="/style" />)
        const link = screen.getByRole('link')
        expect(link).toHaveClass('flex', 'w-full', 'items-center', 'gap-2', 'rounded-lg')
      })

      it('should have text span with correct styling', () => {
        render(<Option iconClassName="i-ri-add-line" text="Text Style" href="/s" />)
        const textSpan = screen.getByText('Text Style')
        expect(textSpan).toHaveClass('min-w-0', 'grow', 'truncate')
      })
    })

    describe('Edge Cases', () => {
      it('should handle empty text', () => {
        render(<Option iconClassName="i-ri-add-line" text="" href="/empty" />)
        const link = screen.getByRole('link')
        expect(link).toBeInTheDocument()
      })

      it('should handle long text', () => {
        const longText = 'Z'.repeat(200)
        render(<Option iconClassName="i-ri-add-line" text={longText} href="/long" />)
        expect(screen.getByText(longText)).toBeInTheDocument()
      })
    })
  })

  // Integration tests for NewDatasetCard component
  describe('NewDatasetCard', () => {
    describe('Rendering', () => {
      it('should render without crashing', () => {
        render(<NewDatasetCard />)
        // All 3 options should be visible
        const links = screen.getAllByRole('link')
        expect(links).toHaveLength(3)
      })

      it('should render the create dataset option', () => {
        render(<NewDatasetCard />)
        expect(screen.getByText(/createDataset/)).toBeInTheDocument()
      })

      it('should render the create from pipeline option', () => {
        render(<NewDatasetCard />)
        expect(screen.getByText(/createFromPipeline/)).toBeInTheDocument()
      })

      it('should render the connect dataset option', () => {
        render(<NewDatasetCard />)
        expect(screen.getByText(/connectDataset/)).toBeInTheDocument()
      })
    })

    describe('Props', () => {
      it('should have correct href for create dataset', () => {
        render(<NewDatasetCard />)
        const links = screen.getAllByRole('link')
        const createLink = links.find(link => link.getAttribute('href') === '/datasets/create')
        expect(createLink).toBeDefined()
      })

      it('should have correct href for create from pipeline', () => {
        render(<NewDatasetCard />)
        const links = screen.getAllByRole('link')
        const pipelineLink = links.find(link => link.getAttribute('href') === '/datasets/create-from-pipeline')
        expect(pipelineLink).toBeDefined()
      })

      it('should have correct href for connect dataset', () => {
        render(<NewDatasetCard />)
        const links = screen.getAllByRole('link')
        const connectLink = links.find(link => link.getAttribute('href') === '/datasets/connect')
        expect(connectLink).toBeDefined()
      })
    })

    describe('Styles', () => {
      it('should have correct container styling', () => {
        const { container } = render(<NewDatasetCard />)
        const wrapper = container.firstChild as HTMLElement
        expect(wrapper).toHaveClass('inline-flex', 'h-41.5', 'flex-col', 'rounded-xl')
      })
    })
  })
})
