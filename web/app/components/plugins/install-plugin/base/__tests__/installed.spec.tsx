import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createPluginDeclarationFixture } from '@/test/fixtures/plugin'
import { PluginCategoryEnum } from '../../../types'
import Installed from '../installed'

it('closes without a navigation link when installation matches the current category', async () => {
  const user = userEvent.setup()
  const onCancel = vi.fn()
  render(
    <Installed
      payload={createPluginDeclarationFixture({ category: PluginCategoryEnum.extension })}
      installContextCategory={PluginCategoryEnum.extension}
      isFailed={false}
      onCancel={onCancel}
    />,
  )

  expect(
    screen.queryByRole('link', { name: 'plugin.installModal.viewDetails' }),
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
  expect(onCancel).toHaveBeenCalledOnce()
})

it('links to the installed category after success but keeps failures in the current context', async () => {
  const user = userEvent.setup()
  const onCancel = vi.fn()
  const payload = createPluginDeclarationFixture({ category: PluginCategoryEnum.extension })
  const { rerender } = render(
    <Installed
      payload={payload}
      installContextCategory={PluginCategoryEnum.trigger}
      isFailed={false}
      onCancel={onCancel}
    />,
  )

  const details = screen.getByRole('link', { name: 'plugin.installModal.viewDetails' })
  expect(details).toHaveAttribute('href', '/integrations/extension')
  await user.click(details)
  expect(onCancel).toHaveBeenCalledOnce()

  rerender(
    <Installed
      payload={payload}
      installContextCategory={PluginCategoryEnum.trigger}
      isFailed
      errMsg="Package verification failed"
      onCancel={onCancel}
    />,
  )
  expect(screen.getByText('Package verification failed')).toBeInTheDocument()
  expect(
    screen.queryByRole('link', { name: 'plugin.installModal.viewDetails' }),
  ).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'common.operation.close' })).toBeEnabled()
})
