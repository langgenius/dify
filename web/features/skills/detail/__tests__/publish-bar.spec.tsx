import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SkillPublishBar } from '../publish-bar'

describe('SkillPublishBar', () => {
  const onOpenVersions = vi.fn()
  const onPublish = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('publishes a draft from the action and keyboard shortcut', async () => {
    const user = userEvent.setup()
    render(
      <SkillPublishBar
        metaLabel="Saved 5 min ago"
        state="draft"
        onOpenVersions={onOpenVersions}
        onPublish={onPublish}
      />,
    )

    expect(screen.getByRole('status')).toHaveAccessibleName(
      'skill.skillManagement.detail.draft. Saved 5 min ago',
    )
    await user.click(screen.getByRole('button', { name: 'skill.skillManagement.detail.publish' }))
    await user.keyboard('{Control>}{Shift>}p{/Shift}{/Control}')

    expect(onPublish).toHaveBeenCalledTimes(2)
  })

  it('shows the published state as up to date and disables publishing', () => {
    render(
      <SkillPublishBar
        metaLabel="Published just now"
        state="published"
        onOpenVersions={onOpenVersions}
        onPublish={onPublish}
      />,
    )

    expect(screen.getByRole('status')).toHaveAccessibleName(
      'skill.skillManagement.detail.upToDate. Published just now',
    )
    expect(
      screen.getByRole('button', { name: 'skill.skillManagement.detail.published' }),
    ).toBeDisabled()
  })

  it('labels an edited published skill as an unpublished update', () => {
    render(
      <SkillPublishBar
        metaLabel="Saved 2 min ago"
        state="unpublished"
        onOpenVersions={onOpenVersions}
        onPublish={onPublish}
      />,
    )

    expect(screen.getByRole('status')).toHaveAccessibleName(
      'skill.skillManagement.detail.unpublishedChanges. Saved 2 min ago',
    )
    expect(
      screen.getByRole('button', { name: 'skill.skillManagement.detail.publishUpdate' }),
    ).toBeEnabled()
  })

  it('keeps the primary action visible but inert while publishing', async () => {
    const user = userEvent.setup()
    render(
      <SkillPublishBar
        metaLabel="Saved 5 min ago"
        state="publishing"
        onOpenVersions={onOpenVersions}
        onPublish={onPublish}
      />,
    )

    const publishingButton = screen.getByRole('button', {
      name: 'skill.skillManagement.detail.publishing',
    })
    expect(publishingButton).toHaveAttribute('aria-disabled', 'true')
    await user.click(publishingButton)
    expect(onPublish).not.toHaveBeenCalled()
  })
})
