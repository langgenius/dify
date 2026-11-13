import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import TagFilter from '../tag-filter'

function TagsExample({ initialValue = ['agent'] }: { initialValue?: string[] }) {
  const [tags, setTags] = useState(initialValue)
  return (
    <>
      <TagFilter value={tags} onChange={setTags} />
      <output aria-label="Selected tags">{JSON.stringify(tags)}</output>
    </>
  )
}

beforeEach(async () => {
  await page.viewport(800, 600)
})

it('filters real tags and applies the chosen tag to the caller and trigger', async () => {
  await render(<TagsExample />)
  await page.getByRole('button', { name: 'pluginTags.tags.agent' }).click()
  const picker = page.getByRole('dialog')
  await picker.getByRole('searchbox', { name: 'common.operation.search' }).fill('ra')
  const rag = picker.getByRole('checkbox', { name: 'pluginTags.tags.rag' })
  await expect.element(rag).toBeVisible()
  await expect
    .element(picker.getByRole('checkbox', { name: 'pluginTags.tags.agent' }))
    .not.toBeInTheDocument()
  await rag.click()

  await expect.element(rag).toBeChecked()
  await expect
    .element(page.getByRole('button', { name: 'pluginTags.tags.agent,pluginTags.tags.rag' }))
    .toBeVisible()
  await expect
    .element(page.getByRole('status', { name: 'Selected tags' }))
    .toHaveTextContent('["agent","rag"]')
})

it('summarizes overflow tags and restores keyboard focus when clearing them', async () => {
  await render(<TagsExample initialValue={['agent', 'rag', 'search']} />)
  const trigger = page.getByRole('button', { name: 'pluginTags.tags.agent,pluginTags.tags.rag +1' })
  await expect.element(trigger).toBeVisible()
  await userEvent.tab()
  await expect.element(trigger).toHaveFocus()
  await userEvent.tab()
  const clear = page.getByRole('button', { name: /^pluginTags.clearSelectedTags/ })
  await expect.element(clear).toHaveFocus()
  await userEvent.keyboard('{Enter}')

  await expect.element(clear).not.toBeInTheDocument()
  await expect.element(page.getByRole('status', { name: 'Selected tags' })).toHaveTextContent('[]')
  await expect.element(page.getByRole('button', { name: 'common.tag.tags' })).toHaveFocus()
})

it('removes the selected tag from both the picker and caller', async () => {
  await render(<TagsExample />)
  await page.getByRole('button', { name: 'pluginTags.tags.agent' }).click()
  const agent = page.getByRole('dialog').getByRole('checkbox', { name: 'pluginTags.tags.agent' })
  await expect.element(agent).toBeChecked()
  await agent.click()

  await expect.element(agent).not.toBeChecked()
  await expect.element(page.getByRole('button', { name: 'common.tag.tags' })).toBeVisible()
  await expect.element(page.getByRole('status', { name: 'Selected tags' })).toHaveTextContent('[]')
})
