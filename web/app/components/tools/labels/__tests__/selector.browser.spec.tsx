import { useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import LabelSelector from '../selector'

function Labels() {
  const [value, setValue] = useState<string[]>([])
  return (
    <section aria-label="Labels">
      <LabelSelector value={value} onChange={setValue} />
    </section>
  )
}

it('retains the real catalog selection after closing and reopening', async () => {
  const screen = await render(<Labels />)
  const trigger = screen.getByRole('region', { name: 'Labels' }).getByRole('button').first()
  await trigger.click()
  const popup = screen.getByRole('dialog')
  await popup.getByRole('checkbox', { name: 'pluginTags.tags.agent', exact: true }).click()
  await popup.getByRole('checkbox', { name: 'pluginTags.tags.rag', exact: true }).click()
  await expect.element(trigger).toMatchTextContent('pluginTags.tags.agent')
  await expect.element(trigger).toMatchTextContent('pluginTags.tags.rag')
  await popup.getByRole('checkbox', { name: 'pluginTags.tags.agent', exact: true }).click()
  await userEvent.keyboard('{Escape}')
  await expect.element(popup).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  await expect.element(trigger).toHaveTextContent('pluginTags.tags.rag')
  await userEvent.keyboard('{Enter}')
  await expect
    .element(popup.getByRole('checkbox', { name: 'pluginTags.tags.rag', exact: true }))
    .toBeVisible()
  await expect
    .element(popup.getByRole('checkbox', { name: 'pluginTags.tags.rag', exact: true }))
    .toBeChecked()
  await expect
    .element(popup.getByRole('checkbox', { name: 'pluginTags.tags.agent', exact: true }))
    .not.toBeChecked()
})

it('filters the real tag catalog, reports no matches, and restores choices when cleared', async () => {
  const screen = await render(<Labels />)
  await screen.getByRole('region', { name: 'Labels' }).getByRole('button').click()
  const popup = screen.getByRole('dialog')
  const search = popup.getByRole('searchbox', { name: 'common.operation.search' })
  await search.fill('rag')
  await expect
    .element(popup.getByRole('checkbox', { name: 'pluginTags.tags.agent', exact: true }))
    .not.toBeInTheDocument()
  await expect
    .element(popup.getByRole('checkbox', { name: 'pluginTags.tags.rag', exact: true }))
    .toBeVisible()
  await search.fill('missing')
  await expect.element(popup.getByText('common.tag.noTag')).toBeVisible()
  await search.fill('')
  await expect
    .element(popup.getByRole('checkbox', { name: 'pluginTags.tags.agent', exact: true }))
    .toBeVisible()
  await expect
    .element(popup.getByRole('checkbox', { name: 'pluginTags.tags.rag', exact: true }))
    .toBeVisible()
})
