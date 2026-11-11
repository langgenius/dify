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
    MARKDOWN_FORM_FIELD_NAME_MAX_LENGTH: 4,
  }
})

describe('MarkdownForm field name maximum length', () => {
  it('should render a field at the configured limit and reject one above it', () => {
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
            name: 'abcd',
            placeholder: 'within-limit',
          },
          children: [],
        },
        {
          type: 'element',
          tagName: 'input',
          properties: {
            type: 'text',
            name: 'abcde',
            placeholder: 'above-limit',
          },
          children: [],
        },
      ],
    } satisfies ComponentProps<typeof MarkdownForm>['node']

    render(<MarkdownForm node={node} />)

    expect(screen.getByPlaceholderText('within-limit')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('above-limit')).not.toBeInTheDocument()
  })
})
