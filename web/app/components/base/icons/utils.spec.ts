import type { AbstractNode } from './utils'
import { render } from '@testing-library/react'
import { generate, normalizeAttrs } from './utils'

describe('generate icon base utils', () => {
  describe('normalizeAttrs', () => {
    it('should normalize class to className', () => {
      const attrs = { class: 'test-class' }
      const result = normalizeAttrs(attrs)
      expect(result).toEqual({ className: 'test-class' })
    })

    it('should normalize style string to style object', () => {
      const attrs = { style: 'color:red;font-size:14px;' }
      const result = normalizeAttrs(attrs)
      expect(result).toEqual({ style: { color: 'red', fontSize: '14px' } })
    })

    it('should handle attributes with dashes and colons', () => {
      const attrs = { 'data-test': 'value', 'xlink:href': 'url' }
      const result = normalizeAttrs(attrs)
      expect(result).toEqual({ dataTest: 'value', xlinkHref: 'url' })
    })
  })

  describe('generate', () => {
    it('should generate React elements from AbstractNode', () => {
      const node: AbstractNode = {
        name: 'div',
        attributes: { class: 'container' },
        children: [
          {
            name: 'span',
            attributes: { style: 'color:blue;' },
            children: [],
          },
        ],
      }

      const { container } = render(generate(node, 'key'))
      // to svg element
      expect(container.firstChild).toHaveClass('container')
      expect(container.querySelector('span')).toHaveStyle({ color: 'rgb(0, 0, 255)' })
    })

    // add not has children
    it('should generate React elements without children', () => {
      const node: AbstractNode = {
        name: 'div',
        attributes: { class: 'container' },
      }
      const { container } = render(generate(node, 'key'))
      // to svg element
      expect(container.firstChild).toHaveClass('container')
    })

    it('should merge rootProps when provided', () => {
      const node: AbstractNode = {
        name: 'div',
        attributes: { class: 'container' },
        children: [],
      }

      const rootProps = { id: 'root' }
      const { container } = render(generate(node, 'key', rootProps))
      expect(container.querySelector('div')).toHaveAttribute('id', 'root')
    })
  })
})
