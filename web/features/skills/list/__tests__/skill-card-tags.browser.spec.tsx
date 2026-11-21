import type { TagResponse as Tag } from '@dify/contracts/api/console/tags/types.gen'
import { useState } from 'react'
import { page } from 'vite-plus/test/browser'
import { TagManagementDialog } from '@/features/tag-management/tag-management-dialog'
import { renderWithTags } from '@/test/tag-management'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { SkillCardTags } from '../skill-card-tags'

const tags: Tag[] = [
  { id: 'support-id', name: 'support', type: 'skill' },
  { id: 'sales-id', name: 'sales', type: 'skill' },
  { id: 'app-id', name: 'support', type: 'app' },
]

it('maps skill tag names to the matching skill options while excluding other resource types', async () => {
  await renderWithTags(<SkillCardTags skillId="skill-1" tags={['support']} />, tags, [
    'dataset.tag.manage',
  ])
  await page.getByRole('combobox', { name: 'support' }).click()
  await expect
    .element(page.getByRole('option', { name: 'support' }))
    .toHaveAttribute('aria-selected', 'true')
  await expect
    .element(page.getByRole('option', { name: 'sales' }))
    .toHaveAttribute('aria-selected', 'false')
  // A duplicate resource name must not create a second selectable option.
  expect(page.getByRole('option', { name: 'support' }).all()).toHaveLength(1)
})

it('opens real skill tag management from the selector and dismisses the selector popup', async () => {
  function Owner() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <SkillCardTags skillId="skill-1" tags={[]} onOpenTagManagement={() => setOpen(true)} />
        <TagManagementDialog type="skill" show={open} onClose={() => setOpen(false)} />
      </>
    )
  }
  await renderWithTags(<Owner />, tags, ['dataset.tag.manage'])
  await page.getByRole('combobox', { name: 'common.tag.addTag' }).click()
  await page.getByRole('button', { name: 'common.tag.manageTags' }).click()
  const dialog = page.getByRole('dialog', { name: 'common.tag.manageTags' })
  await expect.element(dialog).toBeVisible()
  await expect.element(dialog.getByRole('textbox', { name: 'common.tag.addNew' })).toBeVisible()
  await expect.element(page.getByRole('listbox')).not.toBeInTheDocument()
})

beforeEach(() => {
  onTestFinished(guardUnexpectedFetch())
})
