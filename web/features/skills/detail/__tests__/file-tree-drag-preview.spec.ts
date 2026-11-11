import type { DragEvent } from 'react'
import { waitFor } from '@testing-library/react'
import { setSkillFileDragPreview } from '../file-tree-drag-preview'

function createDragEvent(setDragImage: (element: Element, x: number, y: number) => void) {
  return {
    dataTransfer: {
      setDragImage,
    },
  } as unknown as DragEvent<HTMLElement>
}

describe('setSkillFileDragPreview', () => {
  it('renders a named preview for a single dragged file', async () => {
    const setDragImage = vi.fn()

    setSkillFileDragPreview(createDragEvent(setDragImage), {
      count: 1,
      iconClassName: 'i-ri-markdown-line',
      name: 'SKILL.md',
    })

    const preview = setDragImage.mock.calls[0]?.[0] as HTMLElement
    expect(preview).toHaveTextContent('SKILL.md')
    expect(preview).toBeInTheDocument()
    await waitFor(() => expect(preview).not.toBeInTheDocument())
  })

  it('renders an item count preview for multiple dragged files', async () => {
    const setDragImage = vi.fn()

    setSkillFileDragPreview(createDragEvent(setDragImage), {
      count: 3,
      iconClassName: 'i-ri-markdown-line',
      name: 'SKILL.md',
    })

    const preview = setDragImage.mock.calls[0]?.[0] as HTMLElement
    expect(preview).toHaveTextContent('3 items')
    expect(preview).not.toHaveTextContent('SKILL.md')
    expect(preview).toBeInTheDocument()
    await waitFor(() => expect(preview).not.toBeInTheDocument())
  })
})
