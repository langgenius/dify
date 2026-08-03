import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DetailSkeleton, SkillDetailRightPanelRail } from '../shell'

describe('Skill detail shell', () => {
  it('opens right-panel tools from the rail', async () => {
    const user = userEvent.setup()
    const onOpenBuilder = vi.fn()
    const onOpenVersions = vi.fn()

    render(
      <SkillDetailRightPanelRail onOpenBuilder={onOpenBuilder} onOpenVersions={onOpenVersions} />,
    )

    await user.click(
      screen.getByRole('button', { name: 'skill.skillManagement.detail.builder.open' }),
    )
    await user.click(
      screen.getByRole('button', { name: 'skill.skillManagement.detail.versionHistory' }),
    )

    expect(onOpenBuilder).toHaveBeenCalledOnce()
    expect(onOpenVersions).toHaveBeenCalledOnce()
  })

  it('renders the loading skeleton layout', () => {
    const { container } = render(<DetailSkeleton />)

    expect(container.firstChild).toHaveClass('flex', 'h-0', 'grow')
    expect(container.querySelectorAll('.opacity-20')).toHaveLength(2)
    expect(container.querySelectorAll('.opacity-10')).toHaveLength(3)
  })
})
