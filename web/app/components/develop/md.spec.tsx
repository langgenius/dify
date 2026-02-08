import { render, screen } from '@testing-library/react'
import { Col, Heading, Properties, Property, PropertyInstruction, Row, SubProperty } from './md'

describe('md.tsx components', () => {
  describe('Heading', () => {
    const defaultProps = {
      url: '/api/messages',
      method: 'GET' as const,
      title: 'Get Messages',
      name: '#get-messages',
    }

    describe('rendering', () => {
      it('should render the method badge', () => {
        render(<Heading {...defaultProps} />)
        expect(screen.getByText('GET')).toBeInTheDocument()
      })

      it('should render the url', () => {
        render(<Heading {...defaultProps} />)
        expect(screen.getByText('/api/messages')).toBeInTheDocument()
      })

      it('should render the title as a link', () => {
        render(<Heading {...defaultProps} />)
        const link = screen.getByRole('link', { name: 'Get Messages' })
        expect(link).toBeInTheDocument()
        expect(link).toHaveAttribute('href', '#get-messages')
      })

      it('should render an anchor span with correct id', () => {
        const { container } = render(<Heading {...defaultProps} />)
        const anchor = container.querySelector('#get-messages')
        expect(anchor).toBeInTheDocument()
      })

      it('should strip # prefix from name for id', () => {
        const { container } = render(<Heading {...defaultProps} name="#with-hash" />)
        const anchor = container.querySelector('#with-hash')
        expect(anchor).toBeInTheDocument()
      })
    })

    describe('method styling', () => {
      it('should apply emerald styles for GET method', () => {
        render(<Heading {...defaultProps} method="GET" />)
        const badge = screen.getByText('GET')
        expect(badge.className).toContain('text-emerald')
        expect(badge.className).toContain('bg-emerald-400/10')
        expect(badge.className).toContain('ring-emerald-300')
      })

      it('should apply sky styles for POST method', () => {
        render(<Heading {...defaultProps} method="POST" />)
        const badge = screen.getByText('POST')
        expect(badge.className).toContain('text-sky')
        expect(badge.className).toContain('bg-sky-400/10')
        expect(badge.className).toContain('ring-sky-300')
      })

      it('should apply amber styles for PUT method', () => {
        render(<Heading {...defaultProps} method="PUT" />)
        const badge = screen.getByText('PUT')
        expect(badge.className).toContain('text-amber')
        expect(badge.className).toContain('bg-amber-400/10')
        expect(badge.className).toContain('ring-amber-300')
      })

      it('should apply rose styles for DELETE method', () => {
        render(<Heading {...defaultProps} method="DELETE" />)
        const badge = screen.getByText('DELETE')
        expect(badge.className).toContain('text-red')
        expect(badge.className).toContain('bg-rose')
        expect(badge.className).toContain('ring-rose')
      })

      it('should apply violet styles for PATCH method', () => {
        render(<Heading {...defaultProps} method="PATCH" />)
        const badge = screen.getByText('PATCH')
        expect(badge.className).toContain('text-violet')
        expect(badge.className).toContain('bg-violet-400/10')
        expect(badge.className).toContain('ring-violet-300')
      })
    })

    describe('badge base styles', () => {
      it('should have rounded-lg class', () => {
        render(<Heading {...defaultProps} />)
        const badge = screen.getByText('GET')
        expect(badge.className).toContain('rounded-lg')
      })

      it('should have font-mono class', () => {
        render(<Heading {...defaultProps} />)
        const badge = screen.getByText('GET')
        expect(badge.className).toContain('font-mono')
      })

      it('should have font-semibold class', () => {
        render(<Heading {...defaultProps} />)
        const badge = screen.getByText('GET')
        expect(badge.className).toContain('font-semibold')
      })

      it('should have ring-1 and ring-inset classes', () => {
        render(<Heading {...defaultProps} />)
        const badge = screen.getByText('GET')
        expect(badge.className).toContain('ring-1')
        expect(badge.className).toContain('ring-inset')
      })
    })

    describe('url styles', () => {
      it('should have font-mono class on url', () => {
        render(<Heading {...defaultProps} />)
        const url = screen.getByText('/api/messages')
        expect(url.className).toContain('font-mono')
      })

      it('should have text-xs class on url', () => {
        render(<Heading {...defaultProps} />)
        const url = screen.getByText('/api/messages')
        expect(url.className).toContain('text-xs')
      })

      it('should have zinc text color on url', () => {
        render(<Heading {...defaultProps} />)
        const url = screen.getByText('/api/messages')
        expect(url.className).toContain('text-zinc-400')
      })
    })

    describe('h2 element', () => {
      it('should render title inside h2', () => {
        render(<Heading {...defaultProps} />)
        const h2 = screen.getByRole('heading', { level: 2 })
        expect(h2).toBeInTheDocument()
        expect(h2).toHaveTextContent('Get Messages')
      })

      it('should have scroll-mt-32 class on h2', () => {
        render(<Heading {...defaultProps} />)
        const h2 = screen.getByRole('heading', { level: 2 })
        expect(h2.className).toContain('scroll-mt-32')
      })
    })
  })

  describe('Row', () => {
    it('should render children', () => {
      render(
        <Row anchor={false}>
          <div>Child 1</div>
          <div>Child 2</div>
        </Row>,
      )
      expect(screen.getByText('Child 1')).toBeInTheDocument()
      expect(screen.getByText('Child 2')).toBeInTheDocument()
    })

    it('should have grid layout', () => {
      const { container } = render(
        <Row anchor={false}>
          <div>Content</div>
        </Row>,
      )
      const row = container.firstChild as HTMLElement
      expect(row.className).toContain('grid')
      expect(row.className).toContain('grid-cols-1')
    })

    it('should have gap classes', () => {
      const { container } = render(
        <Row anchor={false}>
          <div>Content</div>
        </Row>,
      )
      const row = container.firstChild as HTMLElement
      expect(row.className).toContain('gap-x-16')
      expect(row.className).toContain('gap-y-10')
    })

    it('should have xl responsive classes', () => {
      const { container } = render(
        <Row anchor={false}>
          <div>Content</div>
        </Row>,
      )
      const row = container.firstChild as HTMLElement
      expect(row.className).toContain('xl:grid-cols-2')
      expect(row.className).toContain('xl:!max-w-none')
    })

    it('should have items-start class', () => {
      const { container } = render(
        <Row anchor={false}>
          <div>Content</div>
        </Row>,
      )
      const row = container.firstChild as HTMLElement
      expect(row.className).toContain('items-start')
    })
  })

  describe('Col', () => {
    it('should render children', () => {
      render(
        <Col anchor={false} sticky={false}>
          <div>Column Content</div>
        </Col>,
      )
      expect(screen.getByText('Column Content')).toBeInTheDocument()
    })

    it('should have first/last child margin classes', () => {
      const { container } = render(
        <Col anchor={false} sticky={false}>
          <div>Content</div>
        </Col>,
      )
      const col = container.firstChild as HTMLElement
      expect(col.className).toContain('[&>:first-child]:mt-0')
      expect(col.className).toContain('[&>:last-child]:mb-0')
    })

    it('should apply sticky classes when sticky is true', () => {
      const { container } = render(
        <Col anchor={false} sticky={true}>
          <div>Sticky Content</div>
        </Col>,
      )
      const col = container.firstChild as HTMLElement
      expect(col.className).toContain('xl:sticky')
      expect(col.className).toContain('xl:top-24')
    })

    it('should not apply sticky classes when sticky is false', () => {
      const { container } = render(
        <Col anchor={false} sticky={false}>
          <div>Non-sticky Content</div>
        </Col>,
      )
      const col = container.firstChild as HTMLElement
      expect(col.className).not.toContain('xl:sticky')
      expect(col.className).not.toContain('xl:top-24')
    })
  })

  describe('Properties', () => {
    it('should render children', () => {
      render(
        <Properties anchor={false}>
          <li>Property 1</li>
          <li>Property 2</li>
        </Properties>,
      )
      expect(screen.getByText('Property 1')).toBeInTheDocument()
      expect(screen.getByText('Property 2')).toBeInTheDocument()
    })

    it('should render as ul with role list', () => {
      render(
        <Properties anchor={false}>
          <li>Property</li>
        </Properties>,
      )
      const list = screen.getByRole('list')
      expect(list).toBeInTheDocument()
      expect(list.tagName).toBe('UL')
    })

    it('should have my-6 margin class', () => {
      const { container } = render(
        <Properties anchor={false}>
          <li>Property</li>
        </Properties>,
      )
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper.className).toContain('my-6')
    })

    it('should have list-none class on ul', () => {
      render(
        <Properties anchor={false}>
          <li>Property</li>
        </Properties>,
      )
      const list = screen.getByRole('list')
      expect(list.className).toContain('list-none')
    })

    it('should have m-0 and p-0 classes on ul', () => {
      render(
        <Properties anchor={false}>
          <li>Property</li>
        </Properties>,
      )
      const list = screen.getByRole('list')
      expect(list.className).toContain('m-0')
      expect(list.className).toContain('p-0')
    })

    it('should have divide-y class on ul', () => {
      render(
        <Properties anchor={false}>
          <li>Property</li>
        </Properties>,
      )
      const list = screen.getByRole('list')
      expect(list.className).toContain('divide-y')
    })

    it('should have max-w constraint class', () => {
      render(
        <Properties anchor={false}>
          <li>Property</li>
        </Properties>,
      )
      const list = screen.getByRole('list')
      expect(list.className).toContain('max-w-[calc(theme(maxWidth.lg)-theme(spacing.8))]')
    })
  })

  describe('Property', () => {
    const defaultProps = {
      name: 'user_id',
      type: 'string',
      anchor: false,
    }

    it('should render name in code element', () => {
      render(
        <Property {...defaultProps}>
          User identifier
        </Property>,
      )
      const code = screen.getByText('user_id')
      expect(code.tagName).toBe('CODE')
    })

    it('should render type', () => {
      render(
        <Property {...defaultProps}>
          User identifier
        </Property>,
      )
      expect(screen.getByText('string')).toBeInTheDocument()
    })

    it('should render children as description', () => {
      render(
        <Property {...defaultProps}>
          User identifier
        </Property>,
      )
      expect(screen.getByText('User identifier')).toBeInTheDocument()
    })

    it('should render as li element', () => {
      const { container } = render(
        <Property {...defaultProps}>
          Description
        </Property>,
      )
      expect(container.querySelector('li')).toBeInTheDocument()
    })

    it('should have m-0 class on li', () => {
      const { container } = render(
        <Property {...defaultProps}>
          Description
        </Property>,
      )
      const li = container.querySelector('li')!
      expect(li.className).toContain('m-0')
    })

    it('should have padding classes on li', () => {
      const { container } = render(
        <Property {...defaultProps}>
          Description
        </Property>,
      )
      const li = container.querySelector('li')!
      expect(li.className).toContain('px-0')
      expect(li.className).toContain('py-4')
    })

    it('should have first:pt-0 and last:pb-0 classes', () => {
      const { container } = render(
        <Property {...defaultProps}>
          Description
        </Property>,
      )
      const li = container.querySelector('li')!
      expect(li.className).toContain('first:pt-0')
      expect(li.className).toContain('last:pb-0')
    })

    it('should render dl element with proper structure', () => {
      const { container } = render(
        <Property {...defaultProps}>
          Description
        </Property>,
      )
      expect(container.querySelector('dl')).toBeInTheDocument()
    })

    it('should have sr-only dt elements for accessibility', () => {
      const { container } = render(
        <Property {...defaultProps}>
          User identifier
        </Property>,
      )
      const dtElements = container.querySelectorAll('dt')
      expect(dtElements.length).toBe(3)
      dtElements.forEach((dt) => {
        expect(dt.className).toContain('sr-only')
      })
    })

    it('should have font-mono class on type', () => {
      render(
        <Property {...defaultProps}>
          Description
        </Property>,
      )
      const typeElement = screen.getByText('string')
      expect(typeElement.className).toContain('font-mono')
      expect(typeElement.className).toContain('text-xs')
    })
  })

  describe('SubProperty', () => {
    const defaultProps = {
      name: 'sub_field',
      type: 'number',
      anchor: false,
    }

    it('should render name in code element', () => {
      render(
        <SubProperty {...defaultProps}>
          Sub field description
        </SubProperty>,
      )
      const code = screen.getByText('sub_field')
      expect(code.tagName).toBe('CODE')
    })

    it('should render type', () => {
      render(
        <SubProperty {...defaultProps}>
          Sub field description
        </SubProperty>,
      )
      expect(screen.getByText('number')).toBeInTheDocument()
    })

    it('should render children as description', () => {
      render(
        <SubProperty {...defaultProps}>
          Sub field description
        </SubProperty>,
      )
      expect(screen.getByText('Sub field description')).toBeInTheDocument()
    })

    it('should render as li element', () => {
      const { container } = render(
        <SubProperty {...defaultProps}>
          Description
        </SubProperty>,
      )
      expect(container.querySelector('li')).toBeInTheDocument()
    })

    it('should have m-0 class on li', () => {
      const { container } = render(
        <SubProperty {...defaultProps}>
          Description
        </SubProperty>,
      )
      const li = container.querySelector('li')!
      expect(li.className).toContain('m-0')
    })

    it('should have different padding than Property (py-1 vs py-4)', () => {
      const { container } = render(
        <SubProperty {...defaultProps}>
          Description
        </SubProperty>,
      )
      const li = container.querySelector('li')!
      expect(li.className).toContain('px-0')
      expect(li.className).toContain('py-1')
    })

    it('should have last:pb-0 class', () => {
      const { container } = render(
        <SubProperty {...defaultProps}>
          Description
        </SubProperty>,
      )
      const li = container.querySelector('li')!
      expect(li.className).toContain('last:pb-0')
    })

    it('should render dl element with proper structure', () => {
      const { container } = render(
        <SubProperty {...defaultProps}>
          Description
        </SubProperty>,
      )
      expect(container.querySelector('dl')).toBeInTheDocument()
    })

    it('should have sr-only dt elements for accessibility', () => {
      const { container } = render(
        <SubProperty {...defaultProps}>
          Sub field description
        </SubProperty>,
      )
      const dtElements = container.querySelectorAll('dt')
      expect(dtElements.length).toBe(3)
      dtElements.forEach((dt) => {
        expect(dt.className).toContain('sr-only')
      })
    })

    it('should have font-mono and text-xs on type', () => {
      render(
        <SubProperty {...defaultProps}>
          Description
        </SubProperty>,
      )
      const typeElement = screen.getByText('number')
      expect(typeElement.className).toContain('font-mono')
      expect(typeElement.className).toContain('text-xs')
    })
  })

  describe('PropertyInstruction', () => {
    it('should render children', () => {
      render(
        <PropertyInstruction>
          This is an instruction
        </PropertyInstruction>,
      )
      expect(screen.getByText('This is an instruction')).toBeInTheDocument()
    })

    it('should render as li element', () => {
      const { container } = render(
        <PropertyInstruction>
          Instruction text
        </PropertyInstruction>,
      )
      expect(container.querySelector('li')).toBeInTheDocument()
    })

    it('should have m-0 class', () => {
      const { container } = render(
        <PropertyInstruction>
          Instruction
        </PropertyInstruction>,
      )
      const li = container.querySelector('li')!
      expect(li.className).toContain('m-0')
    })

    it('should have padding classes', () => {
      const { container } = render(
        <PropertyInstruction>
          Instruction
        </PropertyInstruction>,
      )
      const li = container.querySelector('li')!
      expect(li.className).toContain('px-0')
      expect(li.className).toContain('py-4')
    })

    it('should have italic class', () => {
      const { container } = render(
        <PropertyInstruction>
          Instruction
        </PropertyInstruction>,
      )
      const li = container.querySelector('li')!
      expect(li.className).toContain('italic')
    })

    it('should have first:pt-0 class', () => {
      const { container } = render(
        <PropertyInstruction>
          Instruction
        </PropertyInstruction>,
      )
      const li = container.querySelector('li')!
      expect(li.className).toContain('first:pt-0')
    })
  })

  describe('integration tests', () => {
    it('should render Property inside Properties', () => {
      render(
        <Properties anchor={false}>
          <Property name="id" type="string" anchor={false}>
            Unique identifier
          </Property>
          <Property name="name" type="string" anchor={false}>
            Display name
          </Property>
        </Properties>,
      )

      expect(screen.getByText('id')).toBeInTheDocument()
      expect(screen.getByText('name')).toBeInTheDocument()
      expect(screen.getByText('Unique identifier')).toBeInTheDocument()
      expect(screen.getByText('Display name')).toBeInTheDocument()
    })

    it('should render Col inside Row', () => {
      render(
        <Row anchor={false}>
          <Col anchor={false} sticky={false}>
            <div>Left column</div>
          </Col>
          <Col anchor={false} sticky={true}>
            <div>Right column</div>
          </Col>
        </Row>,
      )

      expect(screen.getByText('Left column')).toBeInTheDocument()
      expect(screen.getByText('Right column')).toBeInTheDocument()
    })

    it('should render PropertyInstruction inside Properties', () => {
      render(
        <Properties anchor={false}>
          <PropertyInstruction>
            Note: All fields are required
          </PropertyInstruction>
          <Property name="required_field" type="string" anchor={false}>
            A required field
          </Property>
        </Properties>,
      )

      expect(screen.getByText('Note: All fields are required')).toBeInTheDocument()
      expect(screen.getByText('required_field')).toBeInTheDocument()
    })
  })
})
