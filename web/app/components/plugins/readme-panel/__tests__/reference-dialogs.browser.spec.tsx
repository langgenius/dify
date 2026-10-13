import type { ReactNode } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import DataSourcePluginActions from '@/app/components/header/account-setting/data-source-page-new/plugin-actions'
import { createDatasourceProvider } from '@/app/components/rag-pipeline/__tests__/datasource-fixtures'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createPluginDetail } from '../../plugin-detail-panel/__tests__/endpoint-fixture'
import Action from '../../plugin-item/action'
import { PluginSource } from '../../types'
import { ReadmeEntrance } from '../entrance'
import ReadmePanel from '../index'
import { useReadmePanelStore } from '../store'

// Installation and settings are independent of the real menu/modal state owners.
vi.mock('../../plugin-detail-panel/detail-header/hooks/use-plugin-operations', () => ({
  usePluginOperations: () => ({
    handleUpdate: vi.fn(),
    handleUpdatedFromMarketplace: vi.fn(),
    handleDelete: vi.fn(),
  }),
}))
vi.mock('../../plugin-page/use-reference-setting', () => ({
  default: () => ({ referenceSetting: undefined }),
  usePluginSettingsAccess: () => ({ canDeletePlugin: false, canUpdatePlugin: false }),
}))
// The README header is display-only; the actions under test are rendered separately.
vi.mock('../../plugin-detail-panel/detail-header', () => ({ default: () => null }))

const detail = {
  ...createPluginDetail(),
  source: PluginSource.github,
  meta: { repo: 'dify/reference-plugin', version: 'v1.0.0', package: 'reference.difypkg' },
}

function renderReference(children: ReactNode, identifier = detail.plugin_unique_identifier) {
  const { wrapper: Wrapper, queryClient } = createConsoleQueryWrapper()
  queryClient.setQueryData(
    consoleQuery.workspaces.current.plugin.readme.get.queryOptions({
      input: { query: { plugin_unique_identifier: identifier, language: 'en_US' } },
    }).queryKey,
    { readme: '# Reference documentation\n\nKeep this content throughout the exit animation.' },
  )
  return render(<Wrapper>{children}</Wrapper>)
}

function observeExit(popup: Element, content: string) {
  return new Promise<{ contentRetained: boolean; panelRetained: boolean; open: boolean }>(
    (resolve) => {
      const onTransition = (event: Event) => {
        if (event.target !== popup) return
        popup.removeEventListener('transitionrun', onTransition)
        resolve({
          contentRetained: popup.textContent?.includes(content) ?? false,
          panelRetained: !!useReadmePanelStore.getState().currentPanel,
          open: useReadmePanelStore.getState().isOpen,
        })
      }
      popup.addEventListener('transitionrun', onTransition)
    },
  )
}

beforeEach(() => {
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  useReadmePanelStore.setState({ isOpen: false, currentPanel: undefined })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('plugin reference dialogs', () => {
  it('keeps plugin information through exit and returns focus to the real item icon', async () => {
    const screen = await renderReference(
      <Action
        author="Dify"
        installationId={detail.id}
        pluginUniqueIdentifier={detail.plugin_unique_identifier}
        pluginName={detail.name}
        category={detail.declaration.category}
        usedInApps={0}
        isShowFetchNewVersion={false}
        isShowInfo
        isShowDelete={false}
        onDelete={vi.fn()}
        meta={detail.meta}
      />,
    )
    const trigger = screen.getByRole('button', { name: 'plugin.action.pluginInfo' })
    await trigger.click()
    const dialog = screen.getByRole('dialog', { name: 'plugin.pluginInfoModal.title' })
    await expect.element(dialog).toBeVisible()
    const popup = dialog.element()
    await expect.poll(() => getComputedStyle(popup).opacity).toBe('1')
    const exiting = observeExit(popup, 'reference.difypkg')
    await dialog.getByRole('button', { name: 'common.operation.close' }).click()
    expect((await exiting).contentRetained).toBe(true)
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect.element(dialog).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
  })

  it('returns information and README opened from the real actions menu to its trigger', async () => {
    const screen = await renderReference(
      <>
        <DataSourcePluginActions detail={detail} />
        <ReadmePanel />
      </>,
    )
    const trigger = screen.getByRole('button', { name: /common.operation.moreActionsFor/ })
    await trigger.click()
    await screen.getByRole('menuitem', { name: 'plugin.detailPanel.operation.info' }).click()
    const information = screen.getByRole('dialog', { name: 'plugin.pluginInfoModal.title' })
    await expect.element(information).toBeVisible()
    await information.getByRole('button', { name: 'common.operation.close' }).click()
    await expect.element(information).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await screen.getByRole('menuitem', { name: 'plugin.detailPanel.operation.viewReadme' }).click()
    const readme = screen.getByRole('dialog', { name: 'plugin.readmeInfo.title' })
    await expect
      .element(readme.getByRole('heading', { name: 'Reference documentation' }))
      .toBeVisible()
    await readme.getByRole('button', { name: 'common.operation.close' }).click()
    await expect.element(readme).not.toBeInTheDocument()
    await expect.poll(() => useReadmePanelStore.getState().currentPanel).toBeUndefined()
    await expect.element(trigger).toHaveFocus()
  })

  it.each(['dialog', 'drawer'] as const)(
    'retains README during %s exit, then releases it and restores entrance focus',
    async (presentation) => {
      const provider = createDatasourceProvider()
      const screen = await renderReference(
        <>
          <ReadmeEntrance pluginDetail={provider} presentation={presentation} />
          <ReadmePanel />
        </>,
        provider.plugin_unique_identifier,
      )
      const trigger = screen.getByRole('button', { name: 'plugin.readmeInfo.needHelpCheckReadme' })
      await trigger.click()
      const dialog = screen.getByRole('dialog', { name: 'plugin.readmeInfo.title' })
      const heading = dialog.getByRole('heading', { name: 'Reference documentation' })
      await expect.element(heading).toBeVisible()
      const popup = dialog.element()
      await expect
        .poll(() => popup.getAnimations().every((animation) => animation.playState === 'finished'))
        .toBe(true)
      const exiting = observeExit(popup, 'Keep this content throughout the exit animation.')
      await dialog.getByRole('button', { name: 'common.operation.close' }).click()
      expect(await exiting).toEqual({ contentRetained: true, panelRetained: true, open: false })
      await expect.element(dialog).not.toBeInTheDocument()
      await expect.poll(() => useReadmePanelStore.getState().currentPanel).toBeUndefined()
      await expect.element(trigger).toHaveFocus()
      await userEvent.keyboard(' ')
      await expect.element(heading).toBeVisible()
      await userEvent.keyboard('{Escape}')
      await expect.element(dialog).not.toBeInTheDocument()
      await expect.element(trigger).toHaveFocus()
    },
  )
})
