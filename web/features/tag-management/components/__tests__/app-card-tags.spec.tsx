import type { Tag } from '@/contract/console/tags'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppCardTags } from '../app-card-tags'

const renderTagSelector = vi.hoisted(() => vi.fn())

vi.mock('@/features/tag-management/components/tag-selector', () => ({
  TagSelector: (props: {
    onOpenTagManagement?: () => void
    onTagsChange?: () => void
    placement: string
    targetId: string
    type: string
    value: Tag[]
  }) => {
    renderTagSelector(props)

    return (
      <div role="group" aria-label="Tag selector mock">
        <span>{props.value.map(tag => tag.name).join(',')}</span>
        <button type="button" onClick={props.onOpenTagManagement}>Manage Tags</button>
        <button type="button" onClick={props.onTagsChange}>Tags Changed</button>
      </div>
    )
  },
}))

const tags: Tag[] = [
  { id: 'tag-1', name: 'Frontend', type: 'app', binding_count: 1 },
  { id: 'tag-2', name: 'Backend', type: 'app', binding_count: 2 },
]

describe('AppCardTags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render TagSelector with app tag bindings', () => {
      render(<AppCardTags appId="app-1" tags={tags} />)

      expect(screen.getByRole('group', { name: 'Tag selector mock' })).toBeInTheDocument()
      expect(screen.getByText('Frontend,Backend')).toBeInTheDocument()
      expect(renderTagSelector).toHaveBeenCalledWith(expect.objectContaining({
        placement: 'bottom-start',
        targetId: 'app-1',
        type: 'app',
        value: tags,
      }))
    })
  })

  describe('Callbacks', () => {
    it('should forward tag management and tag change callbacks', () => {
      const onOpenTagManagement = vi.fn()
      const onTagsChange = vi.fn()

      render(
        <AppCardTags
          appId="app-1"
          tags={tags}
          onOpenTagManagement={onOpenTagManagement}
          onTagsChange={onTagsChange}
        />,
      )

      fireEvent.click(screen.getByText('Manage Tags'))
      fireEvent.click(screen.getByText('Tags Changed'))

      expect(onOpenTagManagement).toHaveBeenCalledTimes(1)
      expect(onTagsChange).toHaveBeenCalledTimes(1)
    })
  })

  describe('Edge Cases', () => {
    it('should pass an empty selection when the app has no tags', () => {
      render(<AppCardTags appId="app-1" tags={[]} />)

      expect(renderTagSelector).toHaveBeenCalledWith(expect.objectContaining({
        value: [],
      }))
    })
  })
})
