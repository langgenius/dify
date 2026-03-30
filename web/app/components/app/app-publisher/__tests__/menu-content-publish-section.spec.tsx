import type { ModelAndParameter } from '../../configuration/debug/types'
import type { AppPublisherMenuContentProps } from '../menu-content.types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import MenuContentPublishSection from '../menu-content-publish-section'

vi.mock('@/app/components/billing/upgrade-btn', () => ({
  default: () => <div data-testid="upgrade-btn">upgrade-btn</div>,
}))

vi.mock('../../workflow/shortcuts-name', () => ({
  default: () => <div data-testid="shortcuts-name">shortcuts-name</div>,
}))

vi.mock('../publish-with-multiple-model', () => ({
  default: ({
    multipleModelConfigs,
    onSelect,
  }: {
    multipleModelConfigs: Array<{ id: string }>
    onSelect: (item: { id: string }) => void
  }) => (
    <button onClick={() => onSelect(multipleModelConfigs[0])}>
      publish-with-multiple-model
    </button>
  ),
}))

const createProps = (overrides: Partial<AppPublisherMenuContentProps> = {}): React.ComponentProps<typeof MenuContentPublishSection> => ({
  debugWithMultipleModel: false,
  draftUpdatedAt: 5678,
  formatTimeFromNow: time => `from-now:${time}`,
  isChatApp: false,
  multipleModelConfigs: [{
    id: 'model-1',
    model: 'gpt-4o',
    parameters: {},
    provider: 'openai',
  }] satisfies ModelAndParameter[],
  onPublish: vi.fn(),
  onRestore: vi.fn(),
  publishDisabled: false,
  published: false,
  publishedAt: undefined,
  publishLoading: false,
  startNodeLimitExceeded: false,
  upgradeHighlightStyle: { color: 'red' },
  ...overrides,
})

describe('MenuContentPublishSection', () => {
  it('should forward selected models when multiple-model publishing is enabled', async () => {
    const user = userEvent.setup()
    const onPublish = vi.fn()

    render(
      <MenuContentPublishSection
        {...createProps({
          debugWithMultipleModel: true,
          onPublish,
        })}
      />,
    )

    await user.click(screen.getByText('publish-with-multiple-model'))

    expect(onPublish).toHaveBeenCalledWith({ id: 'model-1' })
  })
})
