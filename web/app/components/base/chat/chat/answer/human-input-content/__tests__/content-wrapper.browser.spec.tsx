import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import ContentWrapper from '../content-wrapper'

it('discloses the human-input content from the keyboard and returns to the collapsed state', async () => {
  await render(
    <ContentWrapper nodeTitle="Approval request" showExpandIcon>
      <p>Review the invoice before approving it.</p>
    </ContentWrapper>,
  )

  const expand = page.getByRole('button', {
    name: 'share.chat.expand Approval request',
  })
  await expect.element(expand).toHaveAttribute('aria-expanded', 'false')
  await expect
    .element(page.getByText('Review the invoice before approving it.'))
    .not.toBeInTheDocument()

  await userEvent.tab()
  await expect.element(expand).toHaveFocus()
  await userEvent.keyboard('{Enter}')

  const collapse = page.getByRole('button', {
    name: 'share.chat.collapse Approval request',
  })
  await expect.element(collapse).toHaveFocus()
  await expect.element(collapse).toHaveAttribute('aria-expanded', 'true')
  await expect.element(page.getByText('Review the invoice before approving it.')).toBeVisible()

  await userEvent.keyboard(' ')
  await expect.element(expand).toHaveFocus()
  await expect
    .element(page.getByText('Review the invoice before approving it.'))
    .not.toBeInTheDocument()
})
