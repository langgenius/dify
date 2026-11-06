// @vitest-environment node

import { renderToString } from 'react-dom/server'
import { CreateAppDialogShell } from '../create-app-dialog-shell'

describe('CreateAppDialogShell', () => {
  // A route that is only this dialog must show it in the server HTML; a portal
  // would leave the page empty until the client hydrates.
  it('server-renders its title and content in place when inline', () => {
    const html = renderToString(
      <CreateAppDialogShell inline show title="Create from Blank" onClose={() => {}}>
        <p>Creation form</p>
      </CreateAppDialogShell>,
    )

    expect(html).toContain('Create from Blank')
    expect(html).toContain('Creation form')
    expect(html).toContain('aria-label="Close"')
  })

  it('renders nothing on the server as a portal dialog', () => {
    const html = renderToString(
      <CreateAppDialogShell show title="Create from Blank" onClose={() => {}}>
        <p>Creation form</p>
      </CreateAppDialogShell>,
    )

    expect(html).not.toContain('Creation form')
  })
})
