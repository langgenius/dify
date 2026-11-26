import { Suspense, use, useRef } from 'react'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { AgentRosterField } from '../agent-roster-field'

it('keeps Agent settings and drawer controls visible while drawer content loads', async () => {
  const { promise, resolve } = createDeferred<string>()
  const { wrapper: QueryProvider } = createConsoleQueryWrapper()

  function Details() {
    return <p>{use(promise)}</p>
  }

  function Settings() {
    const portalContainerRef = useRef<HTMLDivElement>(null)

    return (
      <div ref={portalContainerRef}>
        <p>Agent task</p>
        <AgentRosterField
          agent={{ id: 'roster-agent', name: 'Roster Agent' }}
          portalContainerRef={portalContainerRef}
          onChange={() => {}}
          panelBody={<Details />}
        />
      </div>
    )
  }

  const screen = await render(
    <QueryProvider>
      <Suspense fallback={<p>Loading Agent settings</p>}>
        <Settings />
      </Suspense>
    </QueryProvider>,
  )

  await screen
    .getByRole('button', { name: /^workflowAgent\.nodes\.agent\.roster\.openPanel/ })
    .click()
  const drawer = screen.getByRole('dialog', { name: 'Roster Agent' })
  await expect.element(drawer.getByRole('button', { name: 'common.operation.close' })).toBeVisible()
  await expect.element(drawer.getByRole('progressbar', { name: 'common.loading' })).toBeVisible()
  await expect.element(screen.getByText('Agent task')).toBeVisible()

  resolve('Agent details')
  await expect.element(drawer.getByText('Agent details')).toBeVisible()
})
