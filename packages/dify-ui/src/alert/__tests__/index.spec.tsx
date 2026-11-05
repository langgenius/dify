import { render } from 'vitest-browser-react'
import { Alert, AlertTitle } from '../index'

describe('Alert', () => {
  it('interrupts only for errors by default', async () => {
    const screen = await render(
      <div>
        <Alert type="error">
          <AlertTitle>Could not save the connection.</AlertTitle>
        </Alert>
        <Alert type="warning">
          <AlertTitle>This connection was updated by someone else.</AlertTitle>
        </Alert>
      </div>,
    )

    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent('Could not save the connection.')
    await expect
      .element(screen.getByRole('status'))
      .toHaveTextContent('This connection was updated by someone else.')
  })

  it('lets a static banner opt out of the live region', async () => {
    const screen = await render(
      <Alert type="error" role="note">
        <AlertTitle>Unavailable</AlertTitle>
      </Alert>,
    )

    await expect.element(screen.getByRole('note')).toHaveTextContent('Unavailable')
    expect(screen.container.querySelector('[role="alert"]')).toBeNull()
  })
})
