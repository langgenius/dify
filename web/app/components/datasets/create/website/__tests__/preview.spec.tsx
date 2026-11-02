import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import WebsitePreview from '../preview'

it('shows the selected crawl result and dismisses its preview', async () => {
  const user = userEvent.setup()
  const hidePreview = vi.fn()
  render(
    <WebsitePreview
      payload={{
        title: 'Installation guide',
        source_url: 'https://example.com/install',
        markdown: 'Install the **package**',
        description: 'A guide',
      }}
      hidePreview={hidePreview}
    />,
  )
  expect(screen.getByText('Installation guide')).toBeInTheDocument()
  expect(screen.getByText('https://example.com/install')).toBeInTheDocument()
  expect(screen.getByText('Install the **package**')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
  expect(hidePreview).toHaveBeenCalledOnce()
})
