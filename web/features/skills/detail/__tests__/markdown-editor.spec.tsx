import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { MarkdownBodyReferencePreview, MarkdownLiveBodyEditor } from '../markdown-editor'

vi.mock('@/app/components/base/markdown', () => ({
  Markdown: ({
    content,
    customComponents,
    remarkPlugins,
  }: {
    content: string
    customComponents?: {
      a?: (props: { children?: ReactNode; href?: string }) => ReactNode
    }
    remarkPlugins?: Array<() => (tree: unknown) => void>
  }) => {
    const ReferenceLink = customComponents?.a
    const referenceNode = {
      type: 'link',
      url: content.match(/\[Guide\]\(<([^>]+)>\)/)?.[1],
    }
    const tree = { type: 'root', children: [referenceNode] }
    remarkPlugins?.forEach((plugin) => plugin()(tree))

    return (
      <article data-testid="skill-markdown-preview">
        <h2>{content.match(/^## (.+)$/m)?.[1]}</h2>
        <pre>
          <code>{content.match(/```\w*\n([\s\S]*?)```/)?.[1]}</code>
        </pre>
        {ReferenceLink?.({
          children: 'Guide',
          href: referenceNode.url,
        })}
      </article>
    )
  },
}))

const markdownBody = `## Usage

\`\`\`bash
pnpm test
\`\`\`

[Guide](<references/guide.md>)`

describe('Skill markdown editor', () => {
  it('renders Markdown before entering the live editor and keeps references interactive', async () => {
    const user = userEvent.setup()
    const onOpenReference = vi.fn()
    const editorRef = createRef<HTMLDivElement>()

    render(
      <MarkdownLiveBodyEditor
        body={markdownBody}
        contentRevision={0}
        editorRef={editorRef}
        onInput={vi.fn()}
        onKeyDown={vi.fn()}
        onOpenReference={onOpenReference}
        placeholder="Write Markdown"
      />,
    )

    expect(screen.getByRole('heading', { name: 'Usage' })).toBeInTheDocument()
    expect(screen.getByText('pnpm test')).toBeInTheDocument()
    expect(document.querySelector('[contenteditable="true"]')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Guide' }))
    expect(onOpenReference).toHaveBeenCalledWith('references/guide.md')
    expect(document.querySelector('[contenteditable="true"]')).not.toBeInTheDocument()

    await user.click(screen.getByRole('heading', { name: 'Usage' }))
    const editor = document.querySelector<HTMLElement>('[contenteditable="true"]')
    expect(editor).toBeInTheDocument()
    await waitFor(() => {
      expect(editor).toHaveFocus()
      expect(document.getSelection()?.anchorOffset).toBe(markdownBody.indexOf('Usage'))
    })
  })

  it('renders read-only Markdown and opens a referenced file', async () => {
    const user = userEvent.setup()
    const onOpenReference = vi.fn()

    render(
      <MarkdownBodyReferencePreview
        body={markdownBody}
        onOpenReference={onOpenReference}
        placeholder="No content"
      />,
    )

    expect(screen.getByRole('heading', { name: 'Usage' })).toBeInTheDocument()
    expect(screen.getByText('pnpm test')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Guide' }))
    expect(onOpenReference).toHaveBeenCalledWith('references/guide.md')
  })
})
