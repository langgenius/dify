import type { ReactNode } from 'react'
import type { consoleClient } from '@/service/console'
import type { marketplaceClient } from '@/service/marketplace'
import { detectPlatform } from '@tanstack/react-hotkeys'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { MainNavSearchButton } from '@/app/components/main-nav/components/search-button'
import { MainNavMobileBar } from '@/app/components/main-nav/mobile-nav'
import { ThemeProvider } from '@/features/theme/provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { createPluginDeclarationFixture } from '@/test/fixtures/plugin'
import { GotoAnything } from '../index'

const api = vi.hoisted(() => ({
  apps: vi.fn<typeof consoleClient.apps.get>(),
  datasets: vi.fn<typeof consoleClient.datasets.get>(),
  skills: vi.fn<typeof consoleClient.workspaces.current.skills.get>(),
  agents: vi.fn<typeof consoleClient.agent.get>(),
  marketplace: vi.fn<typeof marketplaceClient.searchAdvanced>(),
  install: vi.fn<typeof consoleClient.workspaces.current.plugin.install.marketplace.post>(),
  push: vi.fn(),
  refresh: vi.fn(),
  pathname: '/',
}))
// boundary: Next's app router is unavailable in the standalone Vitest browser page.
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useRouter: () => ({ push: api.push, refresh: api.refresh }),
  usePathname: () => api.pathname,
  useParams: () => ({}),
}))
// boundary: search-result reads and plugin installation stop at the generated console transport.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.get': api.apps,
      'workspaces.current.defaultModel.get': async () => ({ data: null }),
      'workspaces.current.tools.builtin.get': async () => [],
      'workspaces.current.tools.api.get': async () => [],
      'workspaces.current.tools.workflow.get': async () => [],
      'workspaces.current.tools.mcp.get': async () => [],
      'datasets.get': api.datasets,
      'workspaces.current.skills.get': api.skills,
      'agent.get': api.agents,
      'workspaces.current.plugin.list.installations.ids.post': async () => ({ plugins: [] }),
      'workspaces.current.models.modelTypes.byModelType.get': async () => ({ data: [] }),
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.plugin.permission.fetch.get': async () => ({
        install_permission: 'everyone',
        debug_permission: 'everyone',
      }),
      'workspaces.current.plugin.tasks.get': async () => ({ tasks: [] }),
      'workspaces.current.plugin.marketplace.pkg.get': async () => ({
        manifest: createPluginDeclarationFixture(),
      }),
      'workspaces.current.plugin.install.marketplace.post': api.install,
    }),
  }
})
// boundary: marketplace discovery is an external HTTP service below the palette owner.
vi.mock('@/service/marketplace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/marketplace')>()
  return {
    ...actual,
    marketplaceQuery: {
      ...actual.marketplaceQuery,
      searchAdvanced: {
        ...actual.marketplaceQuery.searchAdvanced,
        queryOptions: (
          options: Parameters<typeof actual.marketplaceQuery.searchAdvanced.queryOptions>[0],
        ) => {
          const original = actual.marketplaceQuery.searchAdvanced.queryOptions(options)
          const input = options.input
          return typeof input === 'symbol'
            ? original
            : { ...original, queryFn: () => api.marketplace(input) }
        },
      },
    },
  }
})

const emptyPage = { data: [], has_more: false, limit: 10, page: 1, total: 0 }
const searchTitle = 'app.gotoAnything.searchTitle'
const shortcut = detectPlatform() === 'mac' ? '{Meta>}k{/Meta}' : '{Control>}k{/Control}'

beforeEach(() => {
  api.apps.mockResolvedValue(emptyPage)
  api.datasets.mockResolvedValue(emptyPage)
  api.skills.mockResolvedValue(emptyPage)
  api.agents.mockResolvedValue({ ...emptyPage, publication_counts: { drafts: 0, published: 0 } })
  api.marketplace.mockResolvedValue({ data: { plugins: [], total: 0 } })
})

function renderPalette(trigger: ReactNode = <MainNavSearchButton />) {
  const { wrapper: ConsoleWrapper } = createConsoleQueryWrapper({
    currentWorkspace: { role: 'owner' },
    features: { enable_skill: true },
    accountProfileMeta: { currentVersion: '1.0.0' },
    workspacePermissionKeys: ['plugin.install'],
    systemFeatures: {
      enable_marketplace: true,
      rbac_enabled: true,
      plugin_installation_permission: {
        plugin_installation_scope: 'all',
        restrict_to_marketplace_only: false,
      },
    },
  })
  return render(
    <ConsoleWrapper>
      <ThemeProvider defaultPreference="light">
        {trigger}
        <GotoAnything />
      </ThemeProvider>
    </ConsoleWrapper>,
  )
}

const searchField = (name = searchTitle) => page.getByRole('combobox', { name })

async function expectActiveOption(
  field: ReturnType<typeof searchField>,
  option: ReturnType<typeof page.getByRole>,
) {
  await expect
    .poll(() => field.element().getAttribute('aria-activedescendant') === option.element().id)
    .toBe(true)
}

async function openWithShortcut() {
  await userEvent.keyboard(shortcut)
  await expect.element(searchField()).toHaveFocus()
}

describe('desktop dialog', () => {
  beforeEach(async () => {
    await page.viewport(1024, 768)
  })

  it('opens with focus in the search field and returns focus to its trigger after one Escape', async () => {
    renderPalette()
    const trigger = page.getByRole('button', { name: searchTitle })
    await trigger.click()
    await expect.element(searchField()).toHaveFocus()

    await userEvent.keyboard('research')
    await expect.element(searchField()).toHaveValue('research')
    await userEvent.keyboard('{Escape}')

    await expect.element(page.getByRole('dialog', { name: searchTitle })).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
  })

  it('keeps DOM focus in the search field while arrow keys move the active option', async () => {
    renderPalette()
    await openWithShortcut()
    const options = page.getByRole('option')
    await expectActiveOption(searchField(), options.nth(0))

    await userEvent.keyboard('{ArrowDown}')

    await expectActiveOption(searchField(), options.nth(1))
    await expect.element(searchField()).toHaveFocus()
  })
  it('starts a command page with its first option highlighted', async () => {
    renderPalette()
    await openWithShortcut()
    const options = page.getByRole('option')
    const language = page.getByRole('option', {
      name: 'app.gotoAnything.actions.languageChangeDesc',
    })
    await expectActiveOption(searchField(), options.nth(0))
    const languageIndex = options.elements().indexOf(language.element() as HTMLElement)

    for (let step = 1; step <= languageIndex; step++) {
      await userEvent.keyboard('{ArrowDown}')
      await expectActiveOption(searchField(), options.nth(step))
    }
    await userEvent.keyboard('{Enter}')

    const languageField = searchField('app.gotoAnything.actions.languageChangeDesc')
    await expect.element(languageField).toHaveFocus()
    await expect.element(language).not.toBeInTheDocument()
    await expectActiveOption(languageField, page.getByRole('option').first())
  })
  it('turns a suggested scope into a token that lists its first result highlighted', async () => {
    api.datasets.mockResolvedValue({ ...emptyPage, data: [createDatasetFixture()], total: 1 })
    renderPalette()
    await openWithShortcut()
    const knowledge = 'app.gotoAnything.groups.knowledgeBases'

    await userEvent.keyboard('knowledgeBases')
    const scopeOption = page.getByRole('option', { name: knowledge })
    await expectActiveOption(searchField(), scopeOption)
    await userEvent.keyboard('{Enter}')

    const scopedField = searchField(knowledge)
    await expect.element(scopedField).toHaveFocus()
    await expect.element(scopedField).toHaveValue('')
    const firstResult = page.getByRole('option').first()
    await expect.element(firstResult).toHaveAccessibleName(/Test Dataset/)
    await expectActiveOption(scopedField, firstResult)
  })

  it('clears a scope token with Backspace in an empty field or with its remove button', async () => {
    renderPalette()
    await openWithShortcut()
    const knowledge = 'app.gotoAnything.groups.knowledgeBases'

    await userEvent.keyboard('@kb ')
    await expect.element(searchField(knowledge)).toHaveFocus()
    await userEvent.keyboard('{Backspace}')
    await expect.element(searchField()).toHaveFocus()

    await userEvent.keyboard('@kb ')
    await expect.element(searchField(knowledge)).toHaveFocus()
    await page.getByRole('button', { name: 'common.operation.remove' }).click()
    await expect.element(searchField()).toHaveFocus()
  })

  it('ignores Backspace while an IME composition is active', async () => {
    renderPalette()
    await openWithShortcut()
    const knowledge = 'app.gotoAnything.groups.knowledgeBases'
    await userEvent.keyboard('@kb ')
    await expect.element(searchField(knowledge)).toHaveFocus()

    searchField(knowledge)
      .element()
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Backspace', isComposing: true, bubbles: true }),
      )

    await expect.element(searchField(knowledge)).toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: 'common.operation.remove' }))
      .toBeVisible()
  })
  it('removes a token only on a fresh Backspace press, not while the key repeats', async () => {
    renderPalette()
    await openWithShortcut()
    const knowledge = 'app.gotoAnything.groups.knowledgeBases'

    await userEvent.keyboard('@kb ab')
    await expect.element(searchField(knowledge)).toHaveValue('ab')
    await userEvent.keyboard('{Backspace>4/}')
    await expect.element(searchField(knowledge)).toHaveValue('')

    await userEvent.keyboard('{Backspace}')
    await expect.element(searchField()).toHaveFocus()
  })

  it('leaves a command page with Backspace in an empty field', async () => {
    renderPalette()
    await openWithShortcut()
    const theme = 'app.gotoAnything.actions.themeCategoryDesc'

    await page.getByRole('option', { name: theme }).click()
    await expect.element(searchField(theme)).toHaveFocus()
    await expect
      .element(page.getByRole('option', { name: /common.theme.dark/ }))
      .toBeInTheDocument()

    await userEvent.keyboard('{Backspace}')
    await expect.element(searchField()).toHaveFocus()
    await expect.element(page.getByRole('option', { name: theme })).toBeInTheDocument()
  })
})

describe('narrow bottom sheet', () => {
  beforeEach(async () => {
    await page.viewport(375, 812)
  })

  it('clears the term on the first Escape and closes on the second', async () => {
    renderPalette()
    await openWithShortcut()
    const sheet = page.getByRole('dialog', { name: searchTitle })
    await expect.element(sheet).toHaveAttribute('data-swipe-direction', 'down')

    await userEvent.keyboard('research')
    await expect.element(searchField()).toHaveValue('research')
    await userEvent.keyboard('{Escape}')
    await expect.element(searchField()).toHaveValue('')
    await expect.element(sheet).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    await expect.element(sheet).not.toBeInTheDocument()
  })

  it('keeps the selected scope when Backspace runs in an empty field', async () => {
    renderPalette()
    await openWithShortcut()
    const knowledgeName = 'app.gotoAnything.groups.knowledgeBases'
    const knowledge = page.getByRole('radio', { name: knowledgeName })

    await knowledge.click()
    await expect.element(knowledge).toBeChecked()
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
    await expect.element(searchField(knowledgeName)).toHaveFocus()
    await userEvent.keyboard('{Backspace}')

    await expect.element(knowledge).toBeChecked()
  })

  it('enters the scope bar on the checked scope with a keyboard-only ring and moves selection with arrows', async () => {
    renderPalette()
    await openWithShortcut()
    const knowledgeName = 'app.gotoAnything.groups.knowledgeBases'
    const knowledge = page.getByRole('radio', { name: knowledgeName })

    await knowledge.click()
    await expect.element(knowledge).toHaveFocus()
    expect(getComputedStyle(knowledge.element()).boxShadow).not.toContain('inset')

    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
    await expect.element(searchField(knowledgeName)).toHaveFocus()
    await userEvent.keyboard('{Tab}')
    await expect.element(knowledge).toHaveFocus()
    expect(getComputedStyle(knowledge.element()).boxShadow).toContain('inset')

    await userEvent.keyboard('{ArrowLeft}')
    const apps = page.getByRole('radio', { name: 'app.gotoAnything.groups.apps' })
    await expect.element(apps).toBeChecked()
    await expect.element(apps).toHaveFocus()
  })

  it('shows a page as a token and a typed scope in the scope bar', async () => {
    renderPalette()
    await openWithShortcut()
    const theme = 'app.gotoAnything.actions.themeCategoryDesc'

    await userEvent.keyboard('/theme ')
    await expect.element(searchField(theme)).toHaveFocus()
    await expect.element(page.getByRole('radiogroup')).not.toBeInTheDocument()
    await userEvent.keyboard('{Backspace}')
    await expect.element(searchField()).toHaveFocus()

    await userEvent.keyboard('@app ')
    await expect
      .element(page.getByRole('radio', { name: 'app.gotoAnything.groups.apps' }))
      .toBeChecked()
    await expect
      .element(page.getByRole('button', { name: 'common.operation.remove' }))
      .not.toBeInTheDocument()
  })
  it('opens from the top bar search button and returns focus to it', async () => {
    renderPalette(<MainNavMobileBar />)
    const trigger = page.getByRole('button', { name: searchTitle })

    await trigger.click()
    const sheet = page.getByRole('dialog', { name: searchTitle })
    await expect.element(sheet).toHaveAttribute('data-swipe-direction', 'down')
    await expect.element(searchField()).toHaveFocus()

    await userEvent.keyboard('{Escape}')
    await expect.element(sheet).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
  })

  it('offers scopes in the dialog when a sidebar trigger opens it on a narrow screen', async () => {
    renderPalette()
    await page.getByRole('button', { name: searchTitle }).click()

    await expect
      .element(page.getByRole('dialog', { name: searchTitle }))
      .not.toHaveAttribute('data-swipe-direction')
    await expect
      .element(page.getByRole('option', { name: 'app.gotoAnything.groups.apps' }))
      .toBeInTheDocument()
    await expect
      .element(searchField())
      .toHaveAttribute('placeholder', 'app.gotoAnything.searchOrFilterPlaceholder')
  })
  it('closes when the viewport widens to the dialog breakpoint', async () => {
    renderPalette()
    await openWithShortcut()
    const sheet = page.getByRole('dialog', { name: searchTitle })
    await expect.element(sheet).toBeInTheDocument()

    await page.viewport(1024, 768)

    await expect.element(sheet).not.toBeInTheDocument()
  })
})
