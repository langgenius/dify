import type { TagResponse as Tag } from '@dify/contracts/api/console/tags/types.gen'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SkillCardTags } from '../components/skill-card-tags'
import { renderWithTags } from './render'

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: ['dataset.tag.manage'],
  }))
})

const tags: Tag[] = [
  { id: 'support-id', name: 'support', type: 'skill' },
  { id: 'sales-id', name: 'sales', type: 'skill' },
  { id: 'app-id', name: 'support', type: 'app' },
]

it('selects skill tags by name while excluding tags from other resource types', async () => {
  const user = userEvent.setup()
  renderWithTags(<SkillCardTags skillId="skill-1" tags={['support']} />, tags)

  await user.click(screen.getByRole('combobox', { name: 'support' }))
  expect(screen.getAllByRole('option', { name: 'support' })).toHaveLength(1)
  expect(screen.getByRole('option', { name: 'support' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('option', { name: 'sales' })).toHaveAttribute('aria-selected', 'false')
})

it('opens tag management through the real tag selector', async () => {
  const user = userEvent.setup()
  const onOpenTagManagement = vi.fn()
  renderWithTags(
    <SkillCardTags skillId="skill-1" tags={[]} onOpenTagManagement={onOpenTagManagement} />,
    tags,
  )

  await user.click(screen.getByRole('combobox', { name: 'common.tag.addTag' }))
  await user.click(screen.getByRole('button', { name: 'common.tag.manageTags' }))
  expect(onOpenTagManagement).toHaveBeenCalledOnce()
})
