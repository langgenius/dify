import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InputVarType } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'
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
          input={{
            type: InputVarType.paragraph,
            output_variable_name: 'approval',
            default: {
              type: 'variable',
              selector: ['node-1', 'output'],
              value: '',
            },
          }}
          nodeName={nodeId => nodeId === 'node-1' ? 'Start Node' : nodeId}
        />,
      )

      expect(screen.getByText('{{Start Node/output}}')).toBeInTheDocument()

      rerender(
        <Note
          input={{
            type: InputVarType.paragraph,
            output_variable_name: 'approval',
            default: {
              type: 'constant',
              value: 'Plain value',
              selector: [],
            },
          }}
          nodeName={nodeId => nodeId}
        />,
      )

      expect(screen.getByText('Plain value')).toBeInTheDocument()
    })

    it('should render a select preview control for select inputs', () => {
      render(
        <Note
          input={{
            type: InputVarType.select,
            output_variable_name: 'approval',
            option_source: {
              type: 'constant',
              selector: [],
              value: ['Approved', 'Rejected'],
            },
          }}
          nodeName={nodeId => nodeId}
        />,
      )

      expect(screen.getByTestId('human-input-note-select-preview')).toBeInTheDocument()
      expect(screen.getByText('Approved')).toBeInTheDocument()
    })

    it('should open the select preview and show option items', async () => {
      const user = userEvent.setup()

      render(
        <Note
          input={{
            type: InputVarType.select,
            output_variable_name: 'approval',
            option_source: {
              type: 'constant',
              selector: [],
              value: ['Approved', 'Rejected'],
            },
          }}
          nodeName={nodeId => nodeId}
        />,
      )

      await user.click(screen.getByRole('combobox', { name: 'human-input-note-select' }))

      expect(await screen.findByRole('option', { name: 'Rejected' })).toBeInTheDocument()
    })

    it('should render upload placeholders for file inputs', () => {
      render(
        <Note
          input={{
            type: InputVarType.singleFile,
            output_variable_name: 'attachment',
            allowed_file_extensions: ['.pdf'],
            allowed_file_types: [],
            allowed_file_upload_methods: [TransferMethod.local_file, TransferMethod.remote_url],
          }}
          nodeName={nodeId => nodeId}
        />,
      )

      expect(screen.getByTestId('human-input-note-file-preview')).toBeInTheDocument()
      expect(screen.getByText('common.fileUploader.uploadFromComputer')).toBeInTheDocument()
      expect(screen.getByText('common.fileUploader.pasteFileLink')).toBeInTheDocument()
    })
  })
})
