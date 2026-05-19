import { render, screen } from '@testing-library/react'
import { Tag } from '../tag'

describe('Tag', () => {
  describe('rendering', () => {
    it('should render children text', () => {
      render(<Tag>GET</Tag>)
      expect(screen.getByText('GET')).toBeInTheDocument()
    })

    it('should render as a span element', () => {
      render(<Tag>POST</Tag>)
      const tag = screen.getByText('POST')
      expect(tag.tagName).toBe('SPAN')
    })
  })

  describe('default color mapping based on HTTP methods', () => {
    it('should apply emerald color for GET method', () => {
      render(<Tag>GET</Tag>)
      const tag = screen.getByText('GET')
      expect(tag.className).toContain('text-emerald')
    })

    it('should apply sky color for POST method', () => {
      render(<Tag>POST</Tag>)
      const tag = screen.getByText('POST')
      expect(tag.className).toContain('text-sky')
    })

    it('should apply amber color for PUT method', () => {
      render(<Tag>PUT</Tag>)
      const tag = screen.getByText('PUT')
      expect(tag.className).toContain('text-amber')
    })

    it('should apply rose color for DELETE method', () => {
      render(<Tag>DELETE</Tag>)
      const tag = screen.getByText('DELETE')
      expect(tag.className).toContain('text-red')
    })

    it('should apply emerald color for unknown methods', () => {
      render(<Tag>UNKNOWN</Tag>)
      const tag = screen.getByText('UNKNOWN')
      expect(tag.className).toContain('text-emerald')
    })

    it('should handle lowercase method names', () => {
      render(<Tag>get</Tag>)
      const tag = screen.getByText('get')
      expect(tag.className).toContain('text-emerald')
    })

    it('should handle mixed case method names', () => {
      render(<Tag>Post</Tag>)
      const tag = screen.getByText('Post')
      expect(tag.className).toContain('text-sky')
    })
  })

  describe('custom color prop', () => {
    it('should override default color with custom emerald color', () => {
      render(<Tag color="emerald">CUSTOM</Tag>)
      const tag = screen.getByText('CUSTOM')
      expect(tag.className).toContain('text-emerald')
    })

    it('should override default color with custom sky color', () => {
      render(<Tag color="sky">CUSTOM</Tag>)
      const tag = screen.getByText('CUSTOM')
      expect(tag.className).toContain('text-sky')
    })

    it('should override default color with custom amber color', () => {
      render(<Tag color="amber">CUSTOM</Tag>)
      const tag = screen.getByText('CUSTOM')
      expect(tag.className).toContain('text-amber')
    })

    it('should override default color with custom rose color', () => {
      render(<Tag color="rose">CUSTOM</Tag>)
      const tag = screen.getByText('CUSTOM')
      expect(tag.className).toContain('text-red')
    })

    it('should override default color with custom zinc color', () => {
      render(<Tag color="zinc">CUSTOM</Tag>)
      const tag = screen.getByText('CUSTOM')
      expect(tag.className).toContain('text-zinc')
    })

    it('should override automatic color mapping with explicit color', () => {
      render(<Tag color="sky">GET</Tag>)
      const tag = screen.getByText('GET')
      expect(tag.className).toContain('text-sky')
    })
  })

  describe('variant styles', () => {
    it('should apply medium variant styles by default', () => {
      render(<Tag>GET</Tag>)
      const tag = screen.getByText('GET')
      expect(tag.className).toContain('rounded-lg')
      expect(tag.className).toContain('px-1.5')
      expect(tag.className).toContain('ring-1')
      expect(tag.className).toContain('ring-inset')
    })

    it('should apply small variant styles', () => {
      render(<Tag variant="small">GET</Tag>)
      const tag = screen.getByText('GET')
      expect(tag.className).not.toContain('rounded-lg')
      expect(tag.className).not.toContain('ring-1')
    })
  })

  describe('base styles', () => {
    it('should always have font-mono class', () => {
      render(<Tag>GET</Tag>)
      const tag = screen.getByText('GET')
      expect(tag.className).toContain('font-mono')
    })

    it('should always have correct font-size class', () => {
      render(<Tag>GET</Tag>)
      const tag = screen.getByText('GET')
      expect(tag.className).toContain('text-[0.625rem]')
    })

    it('should always have font-semibold class', () => {
      render(<Tag>GET</Tag>)
      const tag = screen.getByText('GET')
      expect(tag.className).toContain('font-semibold')
    })

    it('should always have leading-6 class', () => {
      render(<Tag>GET</Tag>)
      const tag = screen.getByText('GET')
      expect(tag.className).toContain('leading-6')
    })
  })

  describe('color styles for medium variant', () => {
    it('should apply full emerald medium styles', () => {
      render(<Tag color="emerald" variant="medium">TEST</Tag>)
      const tag = screen.getByText('TEST')
      expect(tag.className).toContain('ring-emerald-300')
      expect(tag.className).toContain('bg-emerald-400/10')
      expect(tag.className).toContain('text-emerald-500')
    })

    it('should apply full sky medium styles', () => {
      render(<Tag color="sky" variant="medium">TEST</Tag>)
      const tag = screen.getByText('TEST')
      expect(tag.className).toContain('ring-sky-300')
      expect(tag.className).toContain('bg-sky-400/10')
      expect(tag.className).toContain('text-sky-500')
    })

    it('should apply full amber medium styles', () => {
      render(<Tag color="amber" variant="medium">TEST</Tag>)
      const tag = screen.getByText('TEST')
      expect(tag.className).toContain('ring-amber-300')
      expect(tag.className).toContain('bg-amber-400/10')
      expect(tag.className).toContain('text-amber-500')
    })

    it('should apply full rose medium styles', () => {
      render(<Tag color="rose" variant="medium">TEST</Tag>)
      const tag = screen.getByText('TEST')
      expect(tag.className).toContain('ring-rose-200')
      expect(tag.className).toContain('bg-rose-50')
      expect(tag.className).toContain('text-red-500')
    })

    it('should apply full zinc medium styles', () => {
      render(<Tag color="zinc" variant="medium">TEST</Tag>)
      const tag = screen.getByText('TEST')
      expect(tag.className).toContain('ring-zinc-200')
      expect(tag.className).toContain('bg-zinc-50')
      expect(tag.className).toContain('text-zinc-500')
    })
  })

  describe('color styles for small variant', () => {
    it('should apply emerald small styles', () => {
      render(<Tag color="emerald" variant="small">TEST</Tag>)
      const tag = screen.getByText('TEST')
      expect(tag.className).toContain('text-emerald-500')
      expect(tag.className).not.toContain('bg-emerald-400/10')
      expect(tag.className).not.toContain('ring-emerald-300')
    })

    it('should apply sky small styles', () => {
      render(<Tag color="sky" variant="small">TEST</Tag>)
      const tag = screen.getByText('TEST')
      expect(tag.className).toContain('text-sky-500')
    })

    it('should apply amber small styles', () => {
      render(<Tag color="amber" variant="small">TEST</Tag>)
      const tag = screen.getByText('TEST')
      expect(tag.className).toContain('text-amber-500')
    })

    it('should apply rose small styles', () => {
      render(<Tag color="rose" variant="small">TEST</Tag>)
      const tag = screen.getByText('TEST')
      expect(tag.className).toContain('text-red-500')
    })

    it('should apply zinc small styles', () => {
      render(<Tag color="zinc" variant="small">TEST</Tag>)
      const tag = screen.getByText('TEST')
      expect(tag.className).toContain('text-zinc-400')
    })
  })

  describe('HTTP method color combinations', () => {
    it('should correctly map PATCH to emerald (default)', () => {
      render(<Tag>PATCH</Tag>)
      const tag = screen.getByText('PATCH')
      expect(tag.className).toContain('text-emerald')
    })

    it('should correctly render all standard HTTP methods', () => {
      const methods = ['GET', 'POST', 'PUT', 'DELETE']
      const expectedColors = ['emerald', 'sky', 'amber', 'red']

      methods.forEach((method, index) => {
        const { unmount } = render(<Tag>{method}</Tag>)
        const tag = screen.getByText(method)
        expect(tag.className).toContain(`text-${expectedColors[index]}`)
        unmount()
      })
    })
  })
})
