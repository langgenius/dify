import { render, screen } from '@testing-library/react'
import { Note, rehypeNotes, rehypeVariable, Variable } from '../variable-in-markdown'

describe('variable-in-markdown', () => {
  describe('rehypeVariable', () => {
    it('should replace variable tokens with variable elements and preserve surrounding text', () => {
      const tree = {
        children: [
          {
            type: 'text',
            value: 'Hello {{#node.field#}} world',
          },
        ],
      }

      rehypeVariable()(tree)

      expect(tree.children).toEqual([
        { type: 'text', value: 'Hello ' },
        {
          type: 'element',
          tagName: 'variable',
          properties: { dataPath: '{{#node.field#}}' },
          children: [],
        },
        { type: 'text', value: ' world' },
      ])
    })

    it('should ignore note tokens while processing variable nodes', () => {
      const tree = {
        children: [
          {
            type: 'text',
            value: 'Hello {{#$node.field#}} world',
          },
        ],
      }

      rehypeVariable()(tree)

      expect(tree.children).toEqual([
        {
          type: 'text',
          value: 'Hello {{#$node.field#}} world',
        },
      ])
    })
  })

  describe('rehypeNotes', () => {
    it('should replace note tokens with section nodes and update the parent tag name', () => {
      const tree = {
        tagName: 'p',
        children: [
          {
            type: 'text',
            value: 'See {{#$node.title#}} please',
          },
        ],
      }

      rehypeNotes()(tree)

      expect(tree.tagName).toBe('div')
      expect(tree.children).toEqual([
        { type: 'text', value: 'See ' },
        {
          type: 'element',
          tagName: 'section',
          properties: { dataName: 'title' },
          children: [],
        },
        { type: 'text', value: ' please' },
      ])
    })
  })

  describe('rendering', () => {
    it('should format variable paths for display', () => {
      render(<Variable path="{{#node.field#}}" />)

      expect(screen.getByText('{{node/field}}')).toBeInTheDocument()
    })

    it('should render note values and replace node ids with labels for variable defaults', () => {
      const { rerender } = render(
        <Note
          defaultInput={{
            type: 'variable',
            selector: ['node-1', 'output'],
            value: '',
          }}
          nodeName={nodeId => nodeId === 'node-1' ? 'Start Node' : nodeId}
        />,
      )

      expect(screen.getByText('{{Start Node/output}}')).toBeInTheDocument()

      rerender(
        <Note
          defaultInput={{
            type: 'constant',
            value: 'Plain value',
            selector: [],
          }}
          nodeName={nodeId => nodeId}
        />,
      )

      expect(screen.getByText('Plain value')).toBeInTheDocument()
    })
  })
})
