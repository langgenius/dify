import type { ContextMenuActions } from '@langgenius/dify-ui/context-menu'
import type { Shape as HooksStoreShape } from '../../hooks-store/store'
import { ContextMenu, ContextMenuTrigger } from '@langgenius/dify-ui/context-menu'
import { createInstance } from 'i18next'
import { useRef } from 'react'
import { I18nextProvider } from 'react-i18next'
import ReactFlow from 'reactflow'
import { cdp, page, userEvent } from 'vite-plus/test/browser'
import agentRoster from '@/i18n/locales/en-US/agent-roster.json'
import common from '@/i18n/locales/en-US/common.json'
import workflowHumanInput from '@/i18n/locales/en-US/workflow-human-input.json'
import workflow from '@/i18n/locales/en-US/workflow.json'
import { createDeferred } from '@/test/deferred'
import { installFakeApi } from '@/test/fake-api'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import BlockSelector from '..'
import { CanvasNodesCatalogProbe } from '../../__tests__/canvas-nodes-catalog-probe'
import { createNode } from '../../__tests__/fixtures'
import { renderWorkflowBrowserComponent } from '../../__tests__/workflow-browser-test-env'
import { usePanelInteractions } from '../../hooks/use-panel-interactions'
import CustomNode from '../../nodes'
import HumanInputMigrationProvider from '../../nodes/human-input-v2/migration/provider'
import { DeliveryMethodType, UserActionButtonType } from '../../nodes/human-input/types'
import { CUSTOM_NOTE_NODE } from '../../note-node/constants'
import { PanelContextmenu } from '../../panel-contextmenu'
import { BlockEnum } from '../../types'
import { TabType } from '../types'
import 'reactflow/dist/style.css'
import '../../style.css'

vi.unmock('react-i18next')
vi.mock('@/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/env')>()
  return {
    ...actual,
    env: {
      ...actual.env,
      NEXT_PUBLIC_ENABLE_AGENT_V2: true,
      NEXT_PUBLIC_ENABLE_AGENT_V2_IN_CHATFLOW: true,
      NEXT_PUBLIC_ENABLE_HITL_IM: true,
    },
  }
})

const actions = [{ id: 'approve', title: 'Approve', button_style: UserActionButtonType.Primary }]
const legacyNode = createNode({
  id: 'approval',
  ariaLabel: 'Approval node',
  position: { x: 32, y: 130 },
  data: {
    title: 'Human Input',
    type: BlockEnum.HumanInput,
    delivery_methods: [
      {
        id: 'e8cf7292-e4f1-4afc-8959-26ac0146036f',
        type: DeliveryMethodType.WebApp,
        enabled: true,
      },
    ],
    form_content: '',
    inputs: [],
    user_actions: actions,
    timeout: 3,
    timeout_unit: 'day',
  },
})
const nodeTypes = { custom: CustomNode }

function Editor() {
  const { handlePaneContextMenu } = usePanelInteractions()
  const menuRef = useRef<ContextMenuActions>(null)
  return (
    <HumanInputMigrationProvider canEdit>
      <div className="relative min-h-0 flex-1">
        <div hidden>
          <CanvasNodesCatalogProbe />
        </div>
        <ContextMenu actionsRef={menuRef}>
          <ContextMenuTrigger render={<div className="size-full" />}>
            <ReactFlow
              role="region"
              aria-label="Workflow canvas"
              defaultNodes={[legacyNode]}
              nodeTypes={nodeTypes}
              onPaneContextMenu={handlePaneContextMenu}
            />
          </ContextMenuTrigger>
          <PanelContextmenu onClose={() => menuRef.current?.close()} />
        </ContextMenu>
        <BlockSelector
          side="bottom"
          align="end"
          trigger={<button type="button">Add node</button>}
          triggerClassName="absolute end-3 top-3"
          availableBlocksTypes={[BlockEnum.AgentV2, BlockEnum.Loop, BlockEnum.HumanInputV2]}
          standalonePanel={TabType.Blocks}
          onSelect={vi.fn()}
        />
      </div>
    </HumanInputMigrationProvider>
  )
}

async function renderEditor(sync?: HooksStoreShape['doSyncWorkflowDraft']) {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    keySeparator: false,
    resources: { 'en-US': { agentRoster, common, workflow, workflowHumanInput } },
  })
  return renderWorkflowBrowserComponent(
    <div className="h-120">
      <I18nextProvider i18n={i18n}>
        <Editor />
      </I18nextProvider>
    </div>,
    {
      hooksStoreProps: sync ? { doSyncWorkflowDraft: sync } : undefined,
      resource: { kind: 'app', appId: 'app-1', mode: 'advanced-chat', collaborationEnabled: false },
      initialStoreState: {
        nodesDefaultConfigs: {
          [BlockEnum.HumanInput]: { version: '2', message_template: { subject: '', body: '' } },
        },
      },
    },
  )
}

const addNode = () => page.getByRole('button', { name: 'Add node', exact: true })
const notice = () => page.getByRole('note', { name: 'Human Input migration notice' })
const row = () => page.getByRole('button', { name: /^Human Input/ })
const card = () => page.getByRole('dialog', { name: 'Human Input', exact: true })
const migrate = () => card().getByRole('button', { name: 'Migrate now' })
const confirmation = () => page.getByRole('alertdialog', { name: /Migrate 1 Human Input/ })

async function openCanvasNodePicker() {
  await page
    .getByRole('region', { name: 'Workflow canvas' })
    .click({ button: 'right', position: { x: 360, y: 100 } })
  await page.getByRole('menuitem', { name: 'Add Node' }).click()
  return page.getByRole('dialog', { name: 'Add Node' })
}

async function expectControlsBelowNotice() {
  await expect.element(notice()).toBeVisible()
  await expect
    .poll(() => addNode().element().getBoundingClientRect().top)
    .toBeGreaterThanOrEqual(notice().element().getBoundingClientRect().bottom)
}

beforeEach(() => {
  onTestFinished(guardUnexpectedFetch())
})

it('keeps the canvas controls below the notice and opens migration from the canvas context menu', async () => {
  await page.viewport(1440, 700)
  await renderEditor()
  await expectControlsBelowNotice()
  const selector = await openCanvasNodePicker()
  await expect.element(row()).toBeInTheDocument()
  await expect
    .element(selector.getByRole('button', { name: 'Migrate now' }))
    .not.toBeInTheDocument()
  await row().hover()
  await expect.element(card()).toBeVisible()
  expect(card().element().getBoundingClientRect().left).toBeGreaterThanOrEqual(
    selector.element().getBoundingClientRect().right,
  )
  await expect.element(card().getByText('By Dify Team')).not.toBeInTheDocument()
  await migrate().hover()
  await migrate().click()
  await expect.element(confirmation()).toBeVisible()
})

it('keeps a narrow canvas usable and returns keyboard focus after cancelling migration', async () => {
  await page.viewport(520, 700)
  await renderEditor()
  await expectControlsBelowNotice()
  await addNode().click()
  await expect.element(page.getByRole('searchbox')).toHaveFocus()
  await page.getByRole('searchbox').fill('Human')
  await userEvent.tab()
  await expect.element(row()).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(migrate()).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(confirmation()).toBeVisible()
  await confirmation().getByRole('button', { name: 'Cancel' }).click()
  await expect.element(row()).toHaveFocus()
})

it('keeps the canvas menu commands reachable alongside the node picker', async () => {
  await page.viewport(1440, 700)
  const { store } = await renderEditor()
  const selector = await openCanvasNodePicker()
  await expect.element(selector.getByRole('searchbox')).toHaveFocus()
  const preview = page.getByRole('menuitem', { name: 'Preview' })
  await preview.hover()
  await expect.element(preview).toHaveFocus()
  const note = page.getByRole('menuitem', { name: 'Add Note' })
  await note.hover()
  await expect.element(note).toHaveFocus()
  await expect.element(selector).toBeVisible()
  await note.click()
  await expect.element(selector).not.toBeInTheDocument()
  await expect.element(note).not.toBeInTheDocument()
  expect(store.getState().candidateNode?.type).toBe(CUSTOM_NOTE_NODE)
})

it('dismisses the canvas menu and picker together when clicking outside both', async () => {
  await page.viewport(1440, 700)
  await renderEditor()
  const selector = await openCanvasNodePicker()
  await expect.element(selector.getByRole('searchbox')).toHaveFocus()
  const menu = page.getByRole('menu')
  await expect.element(menu).toBeVisible()
  await userEvent.pointer({ keys: '[MouseLeft]', coords: { x: 240, y: 100 } })
  await expect.element(selector).not.toBeInTheDocument()
  await expect.element(menu).not.toBeInTheDocument()
})

it('opens the card on touch and flips it to the left at the right edge of the canvas', async () => {
  await page.viewport(1100, 700)
  await renderEditor()
  await addNode().click()
  const bounds = row().element().getBoundingClientRect()
  await cdp().send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }],
  })
  await cdp().send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect.element(migrate()).toBeVisible()
  expect(card().element().getBoundingClientRect().right).toBeLessThanOrEqual(
    page.getByRole('dialog', { name: 'Add Node' }).element().getBoundingClientRect().left,
  )
})

it('replaces a pinned migration card when hovering another node preview', async () => {
  await page.viewport(1100, 700)
  await renderEditor()
  await addNode().click()
  await row().click()
  await expect.element(migrate()).toBeVisible()
  await page.getByRole('button', { name: 'Loop', exact: true }).hover()
  await expect.element(card()).not.toBeInTheDocument()
  const loopPreview = page.getByText(workflow['blocksAbout.loop'], { exact: true }).last()
  await expect.poll(() => loopPreview.element().getBoundingClientRect().width).toBeGreaterThan(1)
  await row().hover()
  await expect.element(migrate()).toBeVisible()
  await migrate().click()
  await expect.element(confirmation()).toBeVisible()
})

it('closes a pinned migration card and lets the user choose an Agent roster action', async () => {
  onTestFinished(
    installFakeApi({
      console: {
        agent: {
          inviteOptions: {
            get: () => ({ data: [], has_more: false, limit: 8, page: 1, total: 0 }),
          },
        },
      },
    }),
  )
  await page.viewport(1100, 700)
  await renderEditor()
  await addNode().click()
  await row().click()
  await expect.element(card()).toBeVisible()
  const migrationCard = card().element()
  await page.getByRole('button', { name: /^Agent/ }).hover()
  const roster = page.getByRole('dialog', { name: 'Select an agent' })
  await expect.element(roster).toBeVisible()
  await expect.poll(() => migrationCard.isConnected).toBe(false)
  await roster.getByRole('menuitem', { name: 'Start from Scratch' }).click()
  await expect.element(page.getByRole('dialog', { name: 'Add Node' })).not.toBeInTheDocument()
})

it('keeps a migration started from a legacy output actionable through a failed save and retry', async () => {
  const firstSave = createDeferred<null>()
  const sync = vi
    .fn<HooksStoreShape['doSyncWorkflowDraft']>()
    .mockReturnValueOnce(firstSave.promise)
    .mockResolvedValue({ hash: 'saved', updatedAt: 1 })
  onTestFinished(
    installFakeApi({
      console: {
        workspaces: {
          current: {
            humanInput: {
              v2: {
                nodeDataMigration: {
                  post: () => ({
                    data: [
                      {
                        node_id: legacyNode.id,
                        node_data: {
                          type: 'human-input',
                          title: 'Human Input',
                          version: '2',
                          user_actions: actions,
                          recipients_spec: [{ type: 'initiator' }],
                          message_template: { subject: '', body: '' },
                          debug_mode: { enabled: false, channels: [] },
                        },
                      },
                    ],
                  }),
                },
              },
            },
          },
        },
      },
    }),
  )
  await page.viewport(1280, 700)
  await renderEditor(sync)
  const node = page.getByRole('button', { name: 'Approval node' })
  await expect.element(node).toBeVisible()
  const output = page.elementLocator(node.element().querySelector('[data-handleid="approve"]')!)
  await output.click()
  await page.getByRole('searchbox').fill('Human')
  await row().click()
  await migrate().click()
  const dialog = page.getByRole('alertdialog')
  const confirm = dialog.getByRole('button', { name: 'Migrate', exact: true })
  await confirm.click()
  await expect.poll(() => sync.mock.calls.length).toBe(1)
  await expect.element(confirmation()).toBeVisible()
  await expect.element(confirm).toHaveAttribute('aria-disabled', 'true')
  firstSave.resolve(null)
  await expect
    .element(dialog.getByRole('alert'))
    .toHaveTextContent(workflow['nodes.humanInputMigration.error.sync'])
  await confirm.click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(notice()).not.toBeInTheDocument()
  expect(sync).toHaveBeenCalledTimes(2)
})
