import type { consoleClient } from '@/service/console'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { apiError, installFakeApi } from '@/test/fake-api'
import DebugInfo from '../debug-info'

type DebugKey = Awaited<ReturnType<typeof consoleClient.workspaces.current.plugin.debuggingKey.get>>

async function setup(debugKey: DebugKey | Promise<DebugKey>) {
  const fake = installFakeApi({
    console: {
      workspaces: { current: { plugin: { debuggingKey: { get: () => debugKey } } } },
    },
  })
  onTestFinished(fake)
  const { wrapper: Providers } = createConsoleQueryWrapper()
  const screen = await render(
    <Providers>
      <DebugInfo />
      <button type="button">After debug info</button>
    </Providers>,
  )
  return { screen, getDebugKey: fake.console.workspaces.current.plugin.debuggingKey.get }
}

it('disables debugging when credentials cannot be loaded', async () => {
  const pending = createDeferred<DebugKey>()
  const { screen, getDebugKey } = await setup(pending.promise)
  const trigger = screen.getByRole('button', { name: 'plugin.debugInfo.title' })
  await expect.element(screen.getByRole('button', { name: 'After debug info' })).toBeVisible()
  await expect.element(trigger).not.toBeInTheDocument()
  await expect.poll(() => getDebugKey).toHaveBeenCalledOnce()
  pending.reject(
    apiError({
      status: 503,
      code: 'DEBUG_KEY_UNAVAILABLE',
      message: 'Debug credentials unavailable',
    }),
  )
  await expect.element(trigger).toBeDisabled()
})

it('opens masked debug metadata from the keyboard and returns focus after dismissal', async () => {
  const { screen } = await setup({
    host: '127.0.0.1',
    port: 5001,
    key: '12345678abcdefghijklmnopqrst87654321',
  })
  const trigger = screen.getByRole('button', { name: 'plugin.debugInfo.title' })
  await expect.element(trigger).toBeEnabled()
  await userEvent.tab()
  await expect.element(trigger).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  const popup = screen.getByRole('dialog')
  await expect.element(popup).toBeVisible()
  await expect
    .element(popup.getByRole('group', { name: 'Port' }))
    .toMatchTextContent('127.0.0.1:5001')
  await expect
    .element(popup.getByRole('group', { name: 'Key' }))
    .toMatchTextContent('12345678********87654321')
  await expect
    .element(popup.getByText('12345678abcdefghijklmnopqrst87654321'))
    .not.toBeInTheDocument()
  await expect
    .element(popup.getByRole('link', { name: 'plugin.debugInfo.viewDocs' }))
    .toHaveAttribute(
      'href',
      'https://docs.dify.ai/en/develop-plugin/features-and-specs/plugin-types/remote-debug-a-plugin',
    )
  await userEvent.keyboard('{Escape}')
  await expect.element(popup).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
})
