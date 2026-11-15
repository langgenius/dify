import type { TagResponse as Tag, TagType } from '@dify/contracts/api/console/tags/types.gen'
import { Combobox, createComboboxItems } from '@langgenius/dify-ui/combobox'
import { useMemo, useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { TagSearchContent } from '../components/tag-search-content'

const tags: Tag[] = [
  { id: 'frontend', name: 'Frontend', type: 'app' },
  { id: 'backend', name: 'Backend', type: 'app' },
]

// TagSearchContent consumes a controlled Combobox. Keep only that primitive state here;
// tag filtering, resource selection and create-option construction belong to TagSelector.
function SearchContent({
  type,
  canBindOrUnbindTags,
  empty,
}: {
  type: TagType
  canBindOrUnbindTags?: boolean
  empty?: boolean
}) {
  const [selected, setSelected] = useState(['frontend'])
  const items = useMemo(
    () =>
      createComboboxItems<Tag, string>(empty ? [] : tags.map((tag) => ({ ...tag, type })), {
        getValue: (tag) => tag.id,
        getLabel: (tag) => tag.name,
      }),
    [empty, type],
  )
  return (
    <Combobox<string, true, Tag>
      items={items}
      multiple
      value={selected}
      onValueChange={setSelected}
    >
      <TagSearchContent type={type} canBindOrUnbindTags={canBindOrUnbindTags} />
    </Combobox>
  )
}

async function renderContent({
  permissions = ['app.tag.manage'],
  type = 'app',
  canBindOrUnbindTags,
  empty,
}: {
  permissions?: string[]
  type?: TagType
  canBindOrUnbindTags?: boolean
  empty?: boolean
} = {}) {
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper({
    workspacePermissionKeys: permissions,
  })
  return render(
    <ConsoleProvider>
      <SearchContent type={type} canBindOrUnbindTags={canBindOrUnbindTags} empty={empty} />
    </ConsoleProvider>,
  )
}

beforeEach(() => onTestFinished(guardUnexpectedFetch()))

it('lets tag managers select and deselect bindings in the draft', async () => {
  const screen = await renderContent()
  const frontend = screen.getByRole('option', { name: 'Frontend' })
  const backend = screen.getByRole('option', { name: 'Backend' })
  await expect.element(frontend).toHaveAttribute('aria-selected', 'true')
  await backend.click()
  await expect.element(backend).toHaveAttribute('aria-selected', 'true')
  await expect.element(frontend).toHaveAttribute('aria-selected', 'true')
  await backend.click()
  await expect.element(backend).toHaveAttribute('aria-selected', 'false')
})

it('keeps bindings read-only without management or binding permission', async () => {
  const screen = await renderContent({ permissions: [] })
  const backend = screen.getByRole('option', { name: 'Backend' })
  await expect.element(backend).toHaveAttribute('aria-disabled', 'true')
  const input = screen.getByRole('combobox', { name: 'common.tag.selectorPlaceholder' })
  await input.click()
  await userEvent.keyboard('{ArrowDown}')
  await expect.element(input).toHaveAttribute('aria-activedescendant', backend.element().id)
  await userEvent.keyboard('{Enter}')
  await expect.element(backend).toHaveAttribute('aria-selected', 'false')
  await expect
    .element(screen.getByRole('option', { name: 'Frontend' }))
    .toHaveAttribute('aria-selected', 'true')
  await expect
    .element(screen.getByRole('button', { name: 'common.tag.manageTags' }))
    .not.toBeInTheDocument()
})

it('allows resource binding without exposing global tag management', async () => {
  const screen = await renderContent({ permissions: [], canBindOrUnbindTags: true })
  const backend = screen.getByRole('option', { name: 'Backend' })
  await backend.click()
  await expect.element(backend).toHaveAttribute('aria-selected', 'true')
  await expect
    .element(screen.getByRole('button', { name: 'common.tag.manageTags' }))
    .not.toBeInTheDocument()
})

it.each([
  { type: 'app' as const, permissions: ['app.tag.manage'] },
  { type: 'snippet' as const, permissions: ['snippets.create_and_modify'] },
])('exposes tag management to the $type permission owner', async ({ type, permissions }) => {
  const screen = await renderContent({ type, permissions })
  await expect.element(screen.getByRole('button', { name: 'common.tag.manageTags' })).toBeVisible()
})

it('explains an empty tag collection', async () => {
  const screen = await renderContent({ empty: true })
  await expect.element(screen.getByText('common.tag.noTag')).toBeVisible()
  await expect.element(screen.getByRole('option')).not.toBeInTheDocument()
})
