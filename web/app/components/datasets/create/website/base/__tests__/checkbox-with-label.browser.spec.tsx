import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import CheckboxWithLabel from '../checkbox-with-label'

function CrawlOptionOwner() {
  const [checked, setChecked] = useState(false)

  return (
    <CheckboxWithLabel
      isChecked={checked}
      onChange={setChecked}
      label="Include subpages"
      tooltip="Crawl linked subpages"
    />
  )
}

it('keeps help separate from the labeled crawl option and restores keyboard focus', async () => {
  await render(<CrawlOptionOwner />)
  const checkbox = page.getByRole('checkbox', { name: 'Include subpages' })
  const help = page.getByRole('button', { name: 'Include subpages' })

  await help.click()
  await expect.element(page.getByText('Crawl linked subpages')).toBeVisible()
  await expect.element(checkbox).not.toBeChecked()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByText('Crawl linked subpages')).not.toBeInTheDocument()
  await expect.element(help).toHaveFocus()

  await page.getByText('Include subpages').click()
  await expect.element(checkbox).toBeChecked()
})
