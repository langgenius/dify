import type { Locator, Page } from '@playwright/test'
import type { DifyWorld } from '../../support/world.ts'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { createTestApp } from '../../../support/api/apps.ts'
import { syncRunnableWorkflowDraft } from '../../../support/api/workflows.ts'
import { createE2EResourceName } from '../../../support/naming.ts'

const getAppId = (world: DifyWorld) => {
  const appId = world.createdAppIds.at(-1)
  if (!appId) throw new Error('No app has been created for the access point scenario.')
  return appId
}

const activateWithKeyboard = async (control: Locator) => {
  await control.focus()
  await expect(control).toBeFocused()
  await control.press('Enter')
}

const expectDialogFocus = async (page: Page, dialog: Locator) => {
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveCSS('opacity', '1')
  await expect(dialog.locator(':focus')).toHaveCount(1)
  for (const key of ['Tab', 'Shift+Tab']) {
    await page.keyboard.press(key)
    await expect(dialog.locator(':focus')).toHaveCount(1)
    const first = await dialog.locator(':focus').elementHandle()
    if (!first) throw new Error('The dialog must contain the keyboard focus.')
    try {
      let completedCycle = false
      for (let index = 0; index < 100; index++) {
        await page.keyboard.press(key)
        await expect(dialog.locator(':focus')).toHaveCount(1)
        if (await first.evaluate((element) => element === element.ownerDocument.activeElement)) {
          completedCycle = true
          break
        }
      }
      expect(completedCycle, `${key} should complete a focus cycle inside the dialog`).toBe(true)
    } finally {
      await first.dispose()
    }
  }
}

const expectExpandedPopup = async (page: Page, control: Locator, popup: Locator) => {
  await expect(control).toHaveAttribute('aria-expanded', 'true')
  const controlledId = await control.getAttribute('aria-controls')
  if (!controlledId) throw new Error('The expanded control must reference its popup.')
  await expect(popup).toBeVisible()
  await expect(popup).toHaveAttribute('id', controlledId)
  await expect(page.locator(`[id=${JSON.stringify(controlledId)}]`)).toHaveCount(1)
  // A popup is visible before its entrance transition has reached its final contrast.
  await expect
    .poll(() =>
      popup.evaluate((element) => {
        let opacity = 1
        for (let current: Element | null = element; current; current = current.parentElement)
          opacity *= Number(getComputedStyle(current).opacity)
        return opacity
      }),
    )
    .toBe(1)
}

Given(
  'a published {word} app with hidden access point inputs',
  async function (this: DifyWorld, kind: string) {
    if (kind !== 'workflow' && kind !== 'chatflow')
      throw new Error(`Unsupported access point app kind "${kind}".`)
    const mode = kind === 'chatflow' ? 'advanced-chat' : 'workflow'
    const client = this.getConsoleClient()
    const app = await createTestApp(client, createE2EResourceName('App', 'AccessPoint'), mode)
    this.createdAppIds.push(app.id)
    this.lastCreatedAppName = app.name
    await syncRunnableWorkflowDraft(client, app.id, {
      mode,
      variables: [
        {
          variable: 'visitor_name',
          label: 'Visitor name',
          type: 'text-input',
          max_length: 80,
          required: false,
          hide: true,
          default: 'E2E visitor',
        },
        {
          variable: 'reply_language',
          label: 'Reply language',
          type: 'select',
          options: ['English', 'French'],
          required: false,
          hide: true,
          default: 'English',
        },
        {
          variable: 'include_details',
          label: 'Include details',
          type: 'checkbox',
          required: false,
          hide: true,
          default: false,
        },
      ],
    })
    await client.apps.byAppId.workflows.publish.post({
      params: { app_id: app.id },
      body: { marked_comment: '', marked_name: '' },
    })
  },
)

Given('the app has a secret key', async function (this: DifyWorld) {
  await this.getConsoleClient().apps.byResourceId.apiKeys.post({
    params: { resource_id: getAppId(this) },
  })
})

Given(
  'the app has a configured MCP server with parameter descriptions',
  async function (this: DifyWorld) {
    await this.getConsoleClient().apps.byAppId.server.post({
      params: { app_id: getAppId(this) },
      body: {
        description: 'E2E access point tool',
        parameters: {
          visitor_name: 'Name of the visitor',
          reply_language: 'Language for the reply',
          include_details: 'Whether to include details',
        },
      },
    })
  },
)

const getAccessPointDialog = (page: Page, surface: string) => {
  if (surface === 'API Key') {
    return {
      dialog: page.getByRole('dialog', { name: 'API Key', exact: true }),
      trigger: page
        .getByRole('region', { name: 'Backend Service API', exact: true })
        .getByRole('button', { name: /^API Key/ }),
    }
  }
  if (surface === 'MCP configuration') {
    return {
      dialog: page.getByRole('dialog', {
        name: 'Add description to enable MCP server',
        exact: true,
      }),
      trigger: page
        .getByRole('region', { name: 'MCP Server', exact: true })
        .getByRole('button', { name: 'Add description', exact: true }),
    }
  }
  if (surface === 'MCP description') {
    return {
      dialog: page.getByRole('dialog', { name: 'Edit description', exact: true }),
      trigger: page
        .getByRole('region', { name: 'MCP Server', exact: true })
        .getByRole('button', { name: 'Edit description', exact: true }),
    }
  }
  const webApp = page.getByRole('region', { name: 'Web App', exact: true })
  if (surface === 'Web App settings') {
    return {
      dialog: page.getByRole('dialog', { name: 'Branding', exact: true }),
      trigger: webApp.getByRole('button', { name: 'Settings', exact: true }),
    }
  }
  if (surface === 'Embedding') {
    return {
      dialog: page.getByRole('dialog', { name: 'Embed on website', exact: true }),
      trigger: webApp.getByRole('button', { name: 'Embed Into Site', exact: true }),
    }
  }
  if (surface === 'Workflow hidden inputs') {
    return {
      dialog: page.getByRole('dialog', { name: 'Pre-Fill Hidden Fields', exact: true }),
      trigger: webApp.getByRole('button', { name: 'Configure', exact: true }),
    }
  }
  throw new Error(`Unknown app access point dialog "${surface}".`)
}

Then('the app access point page should be ready', async function (this: DifyWorld) {
  const page = this.getPage()
  await expect(page).toHaveURL(/\/app\/[^/]+\/access-point(?:\?.*)?$/)
  await expect(page.getByRole('heading', { name: 'Access Point', level: 1 })).toBeVisible()
  for (const name of ['Web App', 'Backend Service API', 'MCP Server']) {
    await expect(page.getByRole('region', { name, exact: true })).toBeVisible()
  }

  const accessPointCards = page
    .getByRole('main')
    .getByRole('region')
    .filter({ has: page.getByRole('heading', { level: 2 }) })
  await expect(accessPointCards.and(page.locator('[aria-busy="true"]'))).toHaveCount(0)
})

When(
  'I open the {string} app access point dialog',
  async function (this: DifyWorld, surface: string) {
    const { dialog, trigger } = getAccessPointDialog(this.getPage(), surface)
    await activateWithKeyboard(trigger)
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveCSS('opacity', '1')
    if (surface === 'API Key') {
      await expect(dialog.getByRole('button', { name: 'Create new Secret key' })).toBeVisible()
    }
  },
)

Then(
  'the app API Key list should contain {int} key(s)',
  async function (this: DifyWorld, count: number) {
    const { dialog } = getAccessPointDialog(this.getPage(), 'API Key')
    await expect(dialog).toBeVisible()
    await expect(
      dialog.getByRole('table', { name: 'API Key', exact: true }).getByRole('row'),
    ).toHaveCount(count + 1)
    await expect(dialog.getByRole('button', { name: /^Delete / })).toHaveCount(count)
  },
)

When('I create a secret key from the app API Key dialog', async function (this: DifyWorld) {
  const { dialog } = getAccessPointDialog(this.getPage(), 'API Key')
  await activateWithKeyboard(
    dialog.getByRole('button', { name: 'Create new Secret key', exact: true }),
  )
})

Then(
  'only the created API Key dialog should receive keyboard focus',
  async function (this: DifyWorld) {
    const page = this.getPage()
    const created = page.getByRole('dialog', { name: 'API key created', exact: true })
    await expectDialogFocus(page, created)
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await expect(created.getByRole('textbox', { name: 'Secret Key', exact: true })).toHaveAttribute(
      'readonly',
      '',
    )
  },
)

When('I acknowledge the created app API Key', async function (this: DifyWorld) {
  const page = this.getPage()
  const created = page.getByRole('dialog', { name: 'API key created', exact: true })
  await activateWithKeyboard(
    created.getByRole('button', { name: 'I have saved this key', exact: true }),
  )
  await expect(created).toBeHidden()
  const { dialog } = getAccessPointDialog(page, 'API Key')
  await expect(
    dialog.getByRole('button', { name: 'Create new Secret key', exact: true }),
  ).toBeFocused()
})

When('I request deletion of the first listed app API Key', async function (this: DifyWorld) {
  const { dialog } = getAccessPointDialog(this.getPage(), 'API Key')
  await activateWithKeyboard(dialog.getByRole('button', { name: /^Delete / }).first())
})

Then(
  'only the app API Key deletion dialog should receive keyboard focus',
  async function (this: DifyWorld) {
    const page = this.getPage()
    const confirmation = page.getByRole('alertdialog', {
      name: 'Delete this secret key?',
      exact: true,
    })
    await expectDialogFocus(page, confirmation)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('alertdialog')).toHaveCount(1)
  },
)

When('I cancel deletion of the app API Key', async function (this: DifyWorld) {
  const page = this.getPage()
  const confirmation = page.getByRole('alertdialog', {
    name: 'Delete this secret key?',
    exact: true,
  })
  await activateWithKeyboard(confirmation.getByRole('button', { name: 'Cancel', exact: true }))
  await expect(confirmation).toBeHidden()
  const { dialog } = getAccessPointDialog(page, 'API Key')
  await expect(dialog.getByRole('button', { name: /^Delete / }).first()).toBeFocused()
})

When('I confirm deletion of the app API Key', async function (this: DifyWorld) {
  const confirmation = this.getPage().getByRole('alertdialog', {
    name: 'Delete this secret key?',
    exact: true,
  })
  await activateWithKeyboard(confirmation.getByRole('button', { name: 'Delete', exact: true }))
  await expect(confirmation).toBeHidden()
})

Then('focus should return to the app API Key creation button', async function (this: DifyWorld) {
  const { dialog } = getAccessPointDialog(this.getPage(), 'API Key')
  await expect(
    dialog.getByRole('button', { name: 'Create new Secret key', exact: true }),
  ).toBeFocused()
})

When('I inspect the Web App settings {string}', async function (this: DifyWorld, state: string) {
  const page = this.getPage()
  const { dialog } = getAccessPointDialog(page, 'Web App settings')
  const title = dialog.getByRole('textbox', { name: 'Web App Name', exact: true })
  await expect(title).toBeVisible()
  if (state === 'form') {
    await expect(
      dialog.getByRole('switch', { name: /^Use web app icon to replace / }),
    ).toBeVisible()
    return
  }
  if (state === 'validation errors') {
    const color = dialog.getByRole('textbox', { name: 'Chat color theme', exact: true })
    const privacy = dialog.getByRole('textbox', { name: 'Privacy Policy', exact: true })
    await title.fill('')
    await color.fill('invalid-color')
    await privacy.fill('invalid-link')
    await activateWithKeyboard(dialog.getByRole('button', { name: 'Save', exact: true }))
    await expect(title).toHaveAttribute('aria-invalid', 'true')
    await expect(title).toHaveAccessibleDescription('Name cannot be empty')
    await expect(color).toHaveAttribute('aria-invalid', 'true')
    await expect(color).toHaveAccessibleDescription(/Invalid hex value/)
    await expect(privacy).toHaveAttribute('aria-invalid', 'true')
    await expect(privacy).toHaveAccessibleDescription(/Invalid privacy policy link/)
    await expect(title).toBeFocused()
    return
  }
  if (state === 'language options') {
    const language = dialog.getByRole('combobox', { name: 'Language', exact: true })
    await activateWithKeyboard(language)
    await expectExpandedPopup(page, language, page.getByRole('listbox'))
    return
  }
  if (state === 'icon picker') {
    await activateWithKeyboard(dialog.getByRole('button', { name: 'Choose icon', exact: true }))
    await expectDialogFocus(page, page.getByRole('dialog', { name: 'Choose icon', exact: true }))
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await expectExpandedPopup(
      page,
      page.getByRole('combobox', { name: /^Search emoji/ }),
      page.getByRole('grid', { name: 'Emoji', exact: true }),
    )
    return
  }
  throw new Error(`Unknown Web App settings state "${state}".`)
})

Then(
  'the Web App settings {string} should restore focus after popup dismissal',
  async function (this: DifyWorld, state: string) {
    const page = this.getPage()
    const { dialog } = getAccessPointDialog(page, 'Web App settings')
    if (state === 'language options') {
      await page.keyboard.press('Escape')
      await expect(page.getByRole('listbox')).toBeHidden()
      await expect(dialog.getByRole('combobox', { name: 'Language', exact: true })).toBeFocused()
    } else if (state === 'icon picker') {
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog', { name: 'Choose icon', exact: true })).toBeHidden()
      await expect(dialog.getByRole('button', { name: 'Choose icon', exact: true })).toBeFocused()
    }
  },
)

When('I fill the app access point hidden input form', async function (this: DifyWorld) {
  const page = this.getPage()
  const dialog = page.getByRole('dialog')
  const name = dialog.getByRole('textbox', { name: 'Visitor name', exact: true })
  await name.fill('Keyboard visitor')
  const language = dialog.getByRole('combobox', { name: 'Reply language', exact: true })
  await activateWithKeyboard(language)
  await activateWithKeyboard(page.getByRole('option', { name: 'French', exact: true }))
  await expect(language).toBeFocused()
  await expect(language).toHaveText('French')
  const details = dialog.getByRole('checkbox', { name: 'Include details', exact: true })
  await details.focus()
  await details.press('Space')
  await expect(details).toBeChecked()
  await expect(name).toHaveValue('Keyboard visitor')
})

When('I open the hidden input language options', async function (this: DifyWorld) {
  const page = this.getPage()
  const { dialog } = getAccessPointDialog(page, 'Workflow hidden inputs')
  const language = dialog.getByRole('combobox', { name: 'Reply language', exact: true })
  await activateWithKeyboard(language)
  await expectExpandedPopup(page, language, page.getByRole('listbox'))
  await expect(page.getByRole('option', { name: 'French', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
})

Then(
  'the hidden input language options should dismiss back to the configuration dialog',
  async function (this: DifyWorld) {
    const page = this.getPage()
    const { dialog, trigger } = getAccessPointDialog(page, 'Workflow hidden inputs')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('listbox')).toBeHidden()
    await expect(
      dialog.getByRole('combobox', { name: 'Reply language', exact: true }),
    ).toBeFocused()
    await activateWithKeyboard(dialog.getByRole('button', { name: 'Cancel', exact: true }))
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
  },
)

When('I expand the embedding hidden input fields', async function (this: DifyWorld) {
  const { dialog } = getAccessPointDialog(this.getPage(), 'Embedding')
  const disclosure = dialog.getByRole('button', { name: /^Pre-Fill Hidden Fields/ })
  await activateWithKeyboard(disclosure)
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true')
})

When(
  'I select the {string} embedding preview',
  async function (this: DifyWorld, embedding: string) {
    const { dialog } = getAccessPointDialog(this.getPage(), 'Embedding')
    const tabNames: Record<string, string> = {
      iframe: 'To add the chat app any where on your website, add this iframe to your html code.',
      scripts: 'To add a chat app to the bottom right of your website add this code to your html.',
      'Chrome extension': 'Install Dify Chatbot Chrome Extension',
    }
    const tabName = tabNames[embedding]
    if (!tabName) throw new Error(`Unknown embedding option "${embedding}".`)
    const tab = dialog.getByRole('tab', { name: tabName, exact: true })
    await activateWithKeyboard(tab)
    await expect(tab).toHaveAttribute('aria-selected', 'true')
  },
)

Then(
  'the selected embedding should expose its preview and copy action',
  async function (this: DifyWorld) {
    const { dialog } = getAccessPointDialog(this.getPage(), 'Embedding')
    await expect(dialog.getByRole('textbox', { name: 'Visitor name', exact: true })).toBeVisible()
    await expect(dialog.getByRole('combobox', { name: 'Reply language', exact: true })).toHaveText(
      'English',
    )
    await expect(
      dialog.getByRole('checkbox', { name: 'Include details', exact: true }),
    ).not.toBeChecked()
    const panel = dialog.getByRole('tabpanel')
    await expect(panel).toBeVisible()
    await expect(panel).toContainText(/https?:\/\//)
    const copy = panel.getByRole('button', { name: 'Copy', exact: true })
    await expect(copy).toBeVisible()
    await copy.focus()
    await this.getPage().keyboard.press('Tab')
    const preview = panel.getByRole('region')
    await expect(preview).toBeFocused()
    const initialScrollLeft = await preview.evaluate((element) => element.scrollLeft)
    await this.getPage().keyboard.down('ArrowRight')
    try {
      await expect(preview).not.toHaveJSProperty('scrollLeft', initialScrollLeft)
    } finally {
      await this.getPage().keyboard.up('ArrowRight')
    }
  },
)

Then(
  'the configured MCP parameter descriptions should be labelled and populated',
  async function (this: DifyWorld) {
    const { dialog } = getAccessPointDialog(this.getPage(), 'MCP description')
    await expect(dialog.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue(
      'E2E access point tool',
    )
    await expect(dialog.getByRole('textbox', { name: 'Visitor name', exact: true })).toHaveValue(
      'Name of the visitor',
    )
    await expect(dialog.getByRole('textbox', { name: 'Reply language', exact: true })).toHaveValue(
      'Language for the reply',
    )
    await expect(dialog.getByRole('textbox', { name: 'Include details', exact: true })).toHaveValue(
      'Whether to include details',
    )
  },
)
