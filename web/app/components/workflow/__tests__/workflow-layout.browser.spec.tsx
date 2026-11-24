import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { page, userEvent } from 'vite-plus/test/browser'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { TEST_APP_ID } from '@/test/console/ids'
import { setupFakeApi } from '@/test/fake-api'
import { createTestNavigation } from '@/test/next-navigation'
import { Workflow } from '..'
import Panel from '../panel'
import { ControlMode } from '../types'
import { renderWorkflowBrowserComponent } from './workflow-browser-test-env'

// boundary: Browser Mode runs without the Next.js router.
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  ...createTestNavigation(),
}))

const { NavigationProvider } = createTestNavigation({ url: '/app/test/workflow' })

setupFakeApi({
  console: {
    apps: {
      byAppId: {
        workflow: {
          comments: { get: () => ({ data: [] }), mentionUsers: { get: () => ({ users: [] }) } },
        },
        workflows: { draft: { variables: { get: () => ({ items: [], total: 0 }) } } },
      },
    },
  },
})

async function renderEditor() {
  await page.viewport(1200, 760)
  return renderWorkflowBrowserComponent(
    <NavigationProvider>
      <NuqsTestingAdapter>
        <EventEmitterContextProvider>
          <div style={{ width: '100vw', height: '100vh' }}>
            <Workflow
              nodes={[]}
              edges={[]}
              viewport={{ x: 0, y: 0, zoom: 1 }}
              sidePanel={<Panel components={{ right: <aside style={{ width: 530 }} /> }} />}
            />
          </div>
        </EventEmitterContextProvider>
      </NuqsTestingAdapter>
    </NavigationProvider>,
    {
      resource: { kind: 'app', appId: TEST_APP_ID, mode: 'workflow', collaborationEnabled: true },
      initialStoreState: {
        controlMode: ControlMode.Comment,
        environmentVariables: [
          {
            id: 'layout-variable',
            name: 'LAYOUT_VARIABLE',
            value: 'value',
            value_type: 'string',
            description: '',
          },
        ],
      },
      historyStore: { nodes: [], edges: [] },
    },
  )
}

it('keeps a mode button clickable over a draft marker', async () => {
  const screen = await renderEditor()
  const pointer = screen.getByRole('button', { name: 'workflow.common.pointerMode' })
  const pane = page.elementLocator(document.querySelector('.react-flow__pane')!)
  await pane.click({ position: { x: 180, y: 300 } })

  const marker = screen.getByRole('button', { name: 'workflow.keyboard.moveDraftComment' })
  await expect.element(marker).toBeVisible()
  await userEvent.dragAndDrop(marker, pointer, {
    sourcePosition: { x: 12, y: 12 },
    targetPosition: { x: 16, y: 16 },
  })

  const buttonRect = pointer.element().getBoundingClientRect()
  const x = buttonRect.left + 16
  const y = buttonRect.top + 16
  const markerRect = marker.element().getBoundingClientRect()
  expect(markerRect.left).toBeLessThan(x)
  expect(markerRect.right).toBeGreaterThan(x)
  expect(markerRect.top).toBeLessThan(y)
  expect(markerRect.bottom).toBeGreaterThan(y)
  expect(pointer.element().contains(document.elementFromPoint(x, y))).toBe(true)

  await pointer.click()
  await expect.element(pointer).toHaveAttribute('aria-pressed', 'true')
  await expect.element(marker).not.toBeInTheDocument()
})

it('centers the toolbar above the inspector and adapts the inspector to its available width', async () => {
  const screen = await renderEditor()
  const pointer = screen.getByRole('button', { name: 'workflow.common.pointerMode' })
  await expect.element(pointer).toBeVisible()
  const initialTop = pointer.element().getBoundingClientRect().top

  await screen
    .getByRole('button', { name: 'workflowDebug.debug.variableInspect.trigger.cached' })
    .click()
  const variable = screen.getByRole('button', { name: /^LAYOUT_VARIABLE/ })
  const menu = screen.getByRole('button', { name: 'workflowDebug.debug.variableInspect.title' })
  await expect.element(variable).toBeVisible()
  await expect.element(menu).not.toBeInTheDocument()
  const openedTop = pointer.element().getBoundingClientRect().top
  expect(openedTop).toBeLessThan(initialTop)

  const resize = screen.getByRole('separator', {
    name: 'workflowDebug.debug.variableInspect.title',
  })
  resize.element().focus()
  await userEvent.keyboard('{Shift>}{ArrowUp}{/Shift}')
  await expect.poll(() => pointer.element().getBoundingClientRect().top).toBeLessThan(openedTop)

  await page.viewport(960, 760)
  await expect.element(menu).toBeVisible()
  const inspectorTop = resize.element().getBoundingClientRect().bottom
  await userEvent.pointer({ keys: '[MouseLeft]', coords: { x: 370, y: inspectorTop + 70 } })
  await expect.element(variable).not.toBeInTheDocument()
  await menu.click()
  await expect.element(variable).toBeVisible()
})
