/**
 * Slow down the test execution to make it easier to follow.
 * Set os environment variable CYPRESS_SLOW_DOWN=true to enable this feature.
 *
 * This will only be used to generate videos for the documentation.
 */
const slowDown = (): void => {
  const queue = (cy as any).queue

  if (!queue)
    console.error('cy.queue is not available, slow down will not work.')

  const originalRunCommand: any = (cy as any).queue.runCommand.bind(queue)
  queue.runCommand = function runCommandWithDelay(cmd: any) {
    let delayInMs = 0
    switch (cmd?.attributes?.name) {
      case 'get':
        // wait after before selecting an element
        delayInMs = 1000
        break
      case 'visit':
        // wait before visiting a new page
        delayInMs = 1000
        break
      case 'location':
        // after navigating to a new page, wait before checking the location
        delayInMs = 5000
        break
    }

    if (!delayInMs)
      return originalRunCommand(cmd)

    return Cypress.Promise.delay(delayInMs).then(() => originalRunCommand(cmd))
  }
}

const isSlowDownEnabled = Cypress.env('SLOW_DOWN')

if (isSlowDownEnabled)
  slowDown()
