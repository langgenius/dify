import { RiAddLine } from '@remixicon/react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CreateAppCard from '../index'
import Option from '../option'

describe('New Dataset Card Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Integration tests for Option component
  describe('Option', () => {
    describe('Rendering', () => {
      it('should render a link with text and icon', () => {
        render(<Option Icon={RiAddLine} text="Create" href="/create" />)
        const link = screen.getByRole('link')
        expect(link).toBeInTheDocument()
        expect(screen.getByText('Create')).toBeInTheDocument()
      })

      it('should render icon with correct sizing class', () => {
        const { container } = render(<Option Icon={RiAddLine} text="Test" href="/test" />)
        const icon = container.querySelector('.h-4.w-4')
        expect(icon).toBeInTheDocument()
      })
    })

    describe('Props', () => {
      it('should set correct href on the link', () => {
        render(<Option Icon={RiAddLine} text="Go" href="/datasets/create" />)
        const link = screen.getByRole('link')
        expect(link).toHaveAttribute('href', '/datasets/create')
      })

      it('should render different text based on props', () => {
        render(<Option Icon={RiAddLine} text="Custom Text" href="/path" />)
        expect(screen.getByText('Custom Text')).toBeInTheDocument()
      })

      it('should render different href based on props', () => {
        render(<Option Icon={RiAddLine} text="Link" href="/custom-path" />)
        const link = screen.getByRole('link')
        expect(link).toHaveAttribute('href', '/custom-path')
      })
    })

    describe('Styles', () => {
      it('should have correct link styling', () => {
        render(<Option Icon={RiAddLine} text="Styled" href="/style" />)
        const link = screen.getByRole('link')
        expect(link).toHaveClass('flex', 'w-full', 'items-center', 'gap-x-2', 'rounded-lg')
      })

      it('should have text span with correct styling', () => {
        render(<Option Icon={RiAddLine} text="Text Style" href="/s" />)
        const textSpan = screen.getByText('Text Style')
        expect(textSpan).toHaveClass('system-sm-medium', 'grow', 'text-left')
      })
    })

    describe('Edge Cases', () => {
      it('should handle empty text', () => {
        render(<Option Icon={RiAddLine} text="" href="/empty" />)
        const link = screen.getByRole('link')
        expect(link).toBeInTheDocument()
      })

      it('should handle long text', () => {
        const longText = 'Z'.repeat(200)
        render(<Option Icon={RiAddLine} text={longText} href="/long" />)
        expect(screen.getByText(longText)).toBeInTheDocument()
      })
    })
  })

  // Integration tests for CreateAppCard component
  describe('CreateAppCard', () => {
    describe('Rendering', () => {
      it('should render without crashing', () => {
        render(<CreateAppCard />)
        // All 3 options should be visible
        const links = screen.getAllByRole('link')
        expect(links).toHaveLength(3)
      })

      it('should render the create dataset option', () => {
        render(<CreateAppCard />)
        expect(screen.getByText(/createDataset/)).toBeInTheDocument()
      })

      it('should render the create from pipeline option', () => {
        render(<CreateAppCard />)
        expect(screen.getByText(/createFromPipeline/)).toBeInTheDocument()
      })

      it('should render the connect dataset option', () => {
        render(<CreateAppCard />)
        expect(screen.getByText(/connectDataset/)).toBeInTheDocument()
      })
    })

    describe('Props', () => {
      it('should have correct href for create dataset', () => {
        render(<CreateAppCard />)
        const links = screen.getAllByRole('link')
        const createLink = links.find(link => link.getAttribute('href') === '/datasets/create')
        expect(createLink).toBeDefined()
      })

      it('should have correct href for create from pipeline', () => {
        render(<CreateAppCard />)
        const links = screen.getAllByRole('link')
        const pipelineLink = links.find(link => link.getAttribute('href') === '/datasets/create-from-pipeline')
        expect(pipelineLink).toBeDefined()
      })

      it('should have correct href for connect dataset', () => {
        render(<CreateAppCard />)
        const links = screen.getAllByRole('link')
        const connectLink = links.find(link => link.getAttribute('href') === '/datasets/connect')
        expect(connectLink).toBeDefined()
      })
    })

    describe('Styles', () => {
      it('should have correct container styling', () => {
        const { container } = render(<CreateAppCard />)
        const wrapper = container.firstChild as HTMLElement
        expect(wrapper).toHaveClass('flex', 'flex-col', 'rounded-xl')
      })
    })
  })
})
