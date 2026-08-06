import type { ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import MarkdownForm from '../form'

vi.mock('@/app/components/base/chat/chat/context', () => ({
  useChatContext: () => ({}),
}))

vi.mock('@/config', async () => {
  const actual = await vi.importActual<typeof import('@/config')>('@/config')
  return {
    ...actual,
    MARKDOWN_FORM_FIELD_NAME_EXTRA_CHARS: '',
  }
})

describe('MarkdownForm default field name characters', () => {
  it('should reject punctuation that requires explicit configuration', () => {
    const node = {
      type: 'element',
      tagName: 'form',
      properties: {},
      children: [
        {
          type: 'element',
          tagName: 'input',
          properties: {
            type: 'text',
            name: '营业&售后（SD）',
            placeholder: 'mixed-width-punctuation',
          },
          children: [],
        },
        {
          type: 'element',
          tagName: 'input',
          properties: {
            type: 'text',
            name: '字段（）！＊＆－',
            placeholder: 'full-width-punctuation',
          },
          children: [],
        },
        {
          type: 'element',
          tagName: 'input',
          properties: {
            type: 'text',
            name: 'field()!*&-',
            placeholder: 'half-width-punctuation',
          },
          children: [],
        },
      ],
    } satisfies ComponentProps<typeof MarkdownForm>['node']

    render(<MarkdownForm node={node} />)

    expect(screen.queryByPlaceholderText('mixed-width-punctuation')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('full-width-punctuation')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('half-width-punctuation')).not.toBeInTheDocument()
  })
})
