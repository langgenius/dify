import type { TagResponse as Tag } from '@dify/contracts/api/console/tags/types.gen'
import type { ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { SkillCardTags } from '../components/skill-card-tags'

const mocks = vi.hoisted(() => ({
  onOpenTagManagement: vi.fn(),
  onTagsChange: vi.fn(),
  tagList: [] as Tag[],
  tagSelectorProps: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: mocks.tagList }),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    tags: {
      get: {
        queryOptions: () => ({}),
      },
    },
  },
}))

vi.mock('../components/tag-selector', () => ({
  TagSelector: (
    props: ComponentProps<'button'> & {
      canBindOrUnbindTags?: boolean
      onOpenTagManagement?: () => void
      onTagsChange?: () => void
      targetId: string
      type: string
      value: Tag[]
    },
  ) => {
    mocks.tagSelectorProps(props)
    return (
      <button type="button" onClick={props.onOpenTagManagement}>
        {props.value.map((tag) => tag.name).join(', ') || 'Add tag'}
      </button>
    )
  },
}))

describe('SkillCardTags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.tagList = [
      { id: 'support-id', name: 'support', type: 'skill' },
      { id: 'sales-id', name: 'sales', type: 'skill' },
      { id: 'app-id', name: 'support', type: 'app' },
    ]
  })

  it('adapts skill tag names to the shared tag selector contract', () => {
    render(
      <SkillCardTags
        skillId="skill-1"
        tags={['support']}
        onOpenTagManagement={mocks.onOpenTagManagement}
        onTagsChange={mocks.onTagsChange}
      />,
    )

    expect(screen.getByRole('button', { name: 'support' })).toBeInTheDocument()
    expect(mocks.tagSelectorProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        canBindOrUnbindTags: true,
        onOpenTagManagement: mocks.onOpenTagManagement,
        onTagsChange: mocks.onTagsChange,
        targetId: 'skill-1',
        type: 'skill',
        value: [{ id: 'support-id', name: 'support', type: 'skill' }],
      }),
    )
  })

  it('forwards the manage-tags interaction', async () => {
    const user = userEvent.setup()
    render(
      <SkillCardTags skillId="skill-1" tags={[]} onOpenTagManagement={mocks.onOpenTagManagement} />,
    )

    await user.click(screen.getByRole('button', { name: 'Add tag' }))

    expect(mocks.onOpenTagManagement).toHaveBeenCalledOnce()
  })
})
