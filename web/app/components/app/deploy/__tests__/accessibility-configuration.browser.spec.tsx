import { page, userEvent } from 'vite-plus/test/browser'
import { checkAccessibility, renderDeploy } from './accessibility-test-env'

vi.unmock('react-i18next')

// boundary: isolated Browser specs do not provide the Next route params runtime.
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ appId: 'deploy-audit' }),
}))

afterEach(() => {
  vi.restoreAllMocks()
})

it('audits the LLM model picker and settings reachable from deploy without mounting workflow editors or media', async () => {
  const screen = await renderDeploy({ withLLM: true })
  await screen.getByRole('button', { name: 'Deploy', exact: true }).click()
  await screen.getByRole('menuitem', { name: 'Dev', exact: true }).click()
  const versions = screen.getByRole('dialog', { name: 'Deploy to Dev', exact: true })
  await expect
    .element(versions.getByRole('heading', { name: 'Deploy to Dev', exact: true }))
    .toHaveFocus()
  await versions.getByRole('button', { name: /Release 1/ }).click()
  const configuration = screen.getByRole('dialog', { name: 'Deploy configuration', exact: true })
  await expect.element(configuration.getByRole('button', { name: /^Chat model/ })).toBeDisabled()
  await configuration.getByRole('combobox', { name: /MODEL/ }).click()
  await screen.getByRole('option', { name: 'Custom value', exact: true }).click()
  await configuration.getByRole('button', { name: 'Configure model', exact: true }).click()
  const modelPicker = screen.getByRole('dialog', { name: 'Configure model', exact: true })
  await expect
    .element(modelPicker.getByRole('button', { name: 'Chat model', exact: true }))
    .toBeVisible()
  await checkAccessibility()
  await modelPicker.getByRole('button', { name: 'Chat model', exact: true }).click()
  await configuration.getByRole('button', { name: 'Model Settings', exact: true }).click()
  const settings = screen.getByRole('dialog', { name: 'Model Settings', exact: true })
  await expect
    .element(settings.getByRole('textbox', { name: 'System instruction', exact: true }))
    .toBeVisible()
  await checkAccessibility()
  expect(document.querySelector('audio, video, [contenteditable="true"]')).toBeNull()
  await userEvent.keyboard('{Escape}')
  await expect.element(settings).not.toBeInTheDocument()
  await expect
    .element(configuration.getByRole('button', { name: 'Model Settings', exact: true }))
    .toHaveFocus()
})

it('opens the workflow source disclosure from the keyboard and restores focus within configuration', async () => {
  const screen = await renderDeploy()
  await screen.getByRole('button', { name: 'Deploy', exact: true }).click()
  await screen.getByRole('menuitem', { name: 'Dev', exact: true }).click()
  const versions = screen.getByRole('dialog', { name: 'Deploy to Dev', exact: true })
  await expect
    .element(versions.getByRole('heading', { name: 'Deploy to Dev', exact: true }))
    .toHaveFocus()
  await versions.getByRole('button', { name: /Release 1/ }).click()
  const configuration = screen.getByRole('dialog', { name: 'Deploy configuration', exact: true })
  const source = configuration.getByRole('button', { name: /Deepseek.*Customer support workflow/ })
  await expect.element(source).toBeVisible()
  source.element().focus()
  await userEvent.keyboard('{Enter}')
  const disclosure = screen.getByRole('dialog', { name: 'Deepseek', exact: true })
  await expect
    .element(disclosure.getByRole('link', { name: 'Customer support workflow', exact: true }))
    .toHaveAttribute('href', '/app/source-workflow/workflow')
  await checkAccessibility()
  await userEvent.keyboard('{Escape}')
  await expect.element(disclosure).not.toBeInTheDocument()
  await expect.element(source).toHaveFocus()
  await expect.element(configuration).toBeVisible()
})

it('reflows the built-in card at 320px and keeps table actions reachable in a short viewport', async () => {
  await page.viewport(320, 256)
  const screen = await renderDeploy()
  const main = screen.getByRole('main', { name: 'Deploy', exact: true })
  const builtIn = screen.getByRole('region', { name: 'Built-in Environment', exact: true })
  await expect.element(builtIn).toBeVisible()
  expect(main.element().scrollWidth).toBeLessThanOrEqual(320)
  const more = screen.getByRole('button', { name: 'Canary · More actions', exact: true })
  more.element().focus()
  await expect.element(more).toHaveFocus()
  const bounds = more.element().getBoundingClientRect()
  expect(bounds.left).toBeGreaterThanOrEqual(0)
  expect(bounds.right).toBeLessThanOrEqual(320)
  expect(bounds.top).toBeGreaterThanOrEqual(0)
  expect(bounds.bottom).toBeLessThanOrEqual(256)
  await userEvent.keyboard('{Enter}')
  await expect
    .element(screen.getByRole('menuitem', { name: 'Redeploy', exact: true }))
    .toBeVisible()
  await screen.getByRole('menuitem', { name: 'Redeploy', exact: true }).click()
  const configuration = screen.getByRole('dialog', { name: 'Deploy configuration', exact: true })
  const cancel = configuration.getByRole('button', { name: 'Cancel', exact: true })
  await expect.element(cancel).toBeVisible()
  cancel.element().focus()
  await expect.element(cancel).toHaveFocus()
  const cancelBounds = cancel.element().getBoundingClientRect()
  expect(cancelBounds.left).toBeGreaterThanOrEqual(0)
  expect(cancelBounds.right).toBeLessThanOrEqual(320)
  expect(cancelBounds.top).toBeGreaterThanOrEqual(0)
  expect(cancelBounds.bottom).toBeLessThanOrEqual(256)
  await userEvent.keyboard('{Enter}')
  await expect.element(configuration).not.toBeInTheDocument()
  await expect.element(more).toHaveFocus()
})

it('keeps focused configuration fields and actions fully visible in a short viewport', async () => {
  await page.viewport(320, 240)
  const screen = await renderDeploy()
  await screen.getByRole('button', { name: 'Deploy latest', exact: true }).click()
  const configuration = screen.getByRole('dialog', { name: 'Deploy configuration', exact: true })
  await expect
    .element(configuration.getByRole('heading', { name: 'Deploy configuration', exact: true }))
    .toHaveFocus()

  const controls = [
    configuration.getByRole('button', { name: /Deepseek.*Customer support workflow/ }),
    configuration.getByRole('combobox', { name: 'Deepseek', exact: true }),
    configuration.getByRole('combobox', { name: /PORT/ }),
    configuration.getByRole('spinbutton', { name: 'PORT', exact: true }),
    configuration.getByRole('button', { name: 'Cancel', exact: true }),
  ]

  for (const control of controls) {
    await userEvent.keyboard('{Tab}')
    await expect.element(control).toHaveFocus()
    const element = control.element()
    const bounds = element.getBoundingClientRect()
    let visibleTop = 0
    let visibleBottom = window.innerHeight

    // A focusable field can pass visibility checks while its scroll area clips the whole field.
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (!['auto', 'hidden', 'scroll', 'clip'].includes(getComputedStyle(parent).overflowY))
        continue
      const parentBounds = parent.getBoundingClientRect()
      visibleTop = Math.max(visibleTop, parentBounds.top + parent.clientTop)
      visibleBottom = Math.min(
        visibleBottom,
        parentBounds.top + parent.clientTop + parent.clientHeight,
      )
    }

    expect(bounds.height).toBeGreaterThan(0)
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(window.innerWidth)
    expect(bounds.top).toBeGreaterThanOrEqual(visibleTop)
    expect(bounds.bottom).toBeLessThanOrEqual(visibleBottom)
  }
})

it('keeps deployment status and version text readable in dark mode', async () => {
  document.documentElement.dataset.theme = 'dark'
  try {
    await renderDeploy()
    await checkAccessibility()
  } finally {
    document.documentElement.dataset.theme = 'light'
  }
})
