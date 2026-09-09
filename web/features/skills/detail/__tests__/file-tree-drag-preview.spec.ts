import type { DragEvent } from 'react'
import { setSkillFileDragPreview } from '../file-tree-drag-preview'

function createDragEvent(setDragImage: (element: Element, x: number, y: number) => void) {
  return {
    dataTransfer: {
      setDragImage,
    },
  } as unknown as DragEvent<HTMLElement>
}

describe('setSkillFileDragPreview', () => {
  it('renders a named preview for a single dragged file', () => {
    const setDragImage = vi.fn()

    setSkillFileDragPreview(createDragEvent(setDragImage), {
      count: 1,
      iconClassName: 'i-ri-markdown-line',
      name: 'SKILL.md',
    })

    const preview = setDragImage.mock.calls[0]?.[0] as HTMLElement
    expect(preview).toHaveTextContent('SKILL.md')
    expect(preview.querySelector('[aria-hidden="true"]')).toHaveClass('i-ri-markdown-line')
    expect(setDragImage).toHaveBeenCalledWith(preview, 10, 12)
  })

  it('renders an item count preview for multiple dragged files', () => {
    const setDragImage = vi.fn()

    setSkillFileDragPreview(createDragEvent(setDragImage), {
      count: 3,
      iconClassName: 'i-ri-markdown-line',
      name: 'SKILL.md',
    })

    const preview = setDragImage.mock.calls[0]?.[0] as HTMLElement
    expect(preview).toHaveTextContent('3 items')
    expect(preview).not.toHaveTextContent('SKILL.md')
    expect(setDragImage).toHaveBeenCalledWith(preview, 10, 12)
  })

  it('skips preview creation when dataTransfer cannot set a drag image', () => {
    const initialChildCount = document.body.childElementCount

    setSkillFileDragPreview(
      {
        dataTransfer: {},
      } as unknown as DragEvent<HTMLElement>,
      {
        count: 1,
        iconClassName: 'i-ri-markdown-line',
        name: 'SKILL.md',
      },
    )

    expect(document.body.childElementCount).toBe(initialChildCount)
  })
})
