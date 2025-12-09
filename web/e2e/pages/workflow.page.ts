import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { BasePage } from './base.page'

/**
 * Workflow Editor Page Object Model
 *
 * Handles interactions with the Dify workflow/canvas editor.
 * Based on: web/app/components/workflow/
 *
 * Key components:
 * - ReactFlow canvas: web/app/components/workflow/index.tsx
 * - Run button: web/app/components/workflow/header/run-mode.tsx
 * - Publish button: web/app/components/workflow/header/index.tsx
 * - Zoom controls: web/app/components/workflow/operator/zoom-in-out.tsx
 * - Node panel: web/app/components/workflow/panel/index.tsx
 * - Block selector: web/app/components/workflow/block-selector/
 */
export class WorkflowPage extends BasePage {
  // Canvas elements - ReactFlow based (web/app/components/workflow/index.tsx)
  readonly canvas: Locator
  readonly minimap: Locator

  // Header action buttons (web/app/components/workflow/header/)
  readonly runButton: Locator
  readonly stopButton: Locator
  readonly publishButton: Locator
  readonly undoButton: Locator
  readonly redoButton: Locator
  readonly historyButton: Locator
  readonly checklistButton: Locator

  // Zoom controls (web/app/components/workflow/operator/zoom-in-out.tsx)
  readonly zoomInButton: Locator
  readonly zoomOutButton: Locator
  readonly zoomPercentage: Locator

  // Node panel - appears when node is selected (web/app/components/workflow/panel/)
  readonly nodeConfigPanel: Locator
  readonly envPanel: Locator
  readonly versionHistoryPanel: Locator

  // Debug and preview panel (web/app/components/workflow/panel/debug-and-preview/)
  readonly debugPreviewPanel: Locator
  readonly chatInput: Locator

  // Block selector - for adding nodes (web/app/components/workflow/block-selector/)
  readonly blockSelector: Locator
  readonly blockSearchInput: Locator

  constructor(page: Page) {
    super(page)

    // Canvas - ReactFlow renders with these classes
    this.canvas = page.locator('.react-flow')
    this.minimap = page.locator('.react-flow__minimap')

    // Run button - shows "Test Run" text with play icon (run-mode.tsx)
    // When running, shows "Running" with loading spinner
    this.runButton = page.locator('.flex.items-center').filter({ hasText: /Test Run|Running|Listening/ }).first()
    this.stopButton = page.locator('button').filter({ has: page.locator('svg.text-text-accent') }).filter({ hasText: '' }).last()

    // Publish button in header (header/index.tsx)
    this.publishButton = page.getByRole('button', { name: /Publish|Update/ })

    // Undo/Redo buttons (header/undo-redo.tsx)
    this.undoButton = page.locator('[class*="undo"]').or(page.getByRole('button', { name: 'Undo' }))
    this.redoButton = page.locator('[class*="redo"]').or(page.getByRole('button', { name: 'Redo' }))

    // History and checklist buttons (header/run-and-history.tsx)
    this.historyButton = page.getByRole('button', { name: /history/i })
    this.checklistButton = page.locator('[class*="checklist"]')

    // Zoom controls at bottom (operator/zoom-in-out.tsx)
    // Uses RiZoomInLine and RiZoomOutLine icons
    this.zoomInButton = page.locator('.react-flow').locator('..').locator('button').filter({ has: page.locator('[class*="zoom-in"]') }).first()
      .or(page.locator('svg[class*="RiZoomInLine"]').locator('..'))
    this.zoomOutButton = page.locator('.react-flow').locator('..').locator('button').filter({ has: page.locator('[class*="zoom-out"]') }).first()
      .or(page.locator('svg[class*="RiZoomOutLine"]').locator('..'))
    this.zoomPercentage = page.locator('.system-sm-medium').filter({ hasText: /%$/ })

    // Node config panel - appears on right when node selected (panel/index.tsx)
    this.nodeConfigPanel = page.locator('.absolute.bottom-1.right-0.top-14')
    this.envPanel = page.locator('[class*="env-panel"]')
    this.versionHistoryPanel = page.locator('[class*="version-history"]')

    // Debug preview panel (panel/debug-and-preview/)
    this.debugPreviewPanel = page.locator('[class*="debug"], [class*="preview-panel"]')
    this.chatInput = page.locator('textarea[placeholder*="Enter"], textarea[placeholder*="input"]')

    // Block selector popup (block-selector/)
    this.blockSelector = page.locator('[class*="block-selector"], [role="dialog"]').filter({ hasText: /LLM|Code|HTTP|IF/ })
    this.blockSearchInput = page.getByPlaceholder(/search/i)
  }

  get path(): string {
    // Dynamic path - will be set when navigating to specific workflow
    return '/app'
  }

  /**
   * Navigate to a specific workflow app by ID
   */
  async gotoWorkflow(appId: string): Promise<void> {
    await this.page.goto(`/app/${appId}/workflow`)
    await this.waitForPageLoad()
    await this.waitForCanvasReady()
  }

  /**
   * Wait for ReactFlow canvas to be fully loaded
   */
  async waitForCanvasReady(): Promise<void> {
    await expect(this.canvas).toBeVisible({ timeout: 30000 })
    // Wait for nodes to render (ReactFlow needs time to initialize)
    await this.page.waitForSelector('.react-flow__node', { timeout: 30000 })
    await this.page.waitForTimeout(500) // Allow animation to complete
  }

  /**
   * Get a node by its displayed title/name
   * Dify nodes use .react-flow__node class with title text inside
   */
  node(name: string): Locator {
    return this.canvas.locator('.react-flow__node').filter({ hasText: name })
  }

  /**
   * Get start node (entry point of workflow)
   */
  get startNode(): Locator {
    return this.canvas.locator('.react-flow__node').filter({ hasText: /Start|开始/ }).first()
  }

  /**
   * Get end node
   */
  get endNode(): Locator {
    return this.canvas.locator('.react-flow__node').filter({ hasText: /End|结束/ }).first()
  }

  /**
   * Add a new node by clicking on canvas edge and selecting from block selector
   * @param nodeType - Node type like 'LLM', 'Code', 'HTTP Request', 'IF/ELSE', etc.
   */
  async addNode(nodeType: string): Promise<void> {
    // Click the + button on a node's edge to open block selector
    const addButton = this.canvas.locator('.react-flow__node').first()
      .locator('[class*="handle"], [class*="add"]')
    await addButton.click()

    // Wait for block selector to appear
    await expect(this.blockSelector).toBeVisible({ timeout: 5000 })

    // Search for node type if search is available
    if (await this.blockSearchInput.isVisible())
      await this.blockSearchInput.fill(nodeType)

    // Click on the node type option
    await this.blockSelector.getByText(nodeType, { exact: false }).first().click()

    await this.waitForCanvasReady()
  }

  /**
   * Select a node on the canvas (opens config panel on right)
   */
  async selectNode(name: string): Promise<void> {
    await this.node(name).click()
    // Config panel should appear
    await expect(this.nodeConfigPanel).toBeVisible({ timeout: 5000 })
  }

  /**
   * Delete the currently selected node using keyboard
   */
  async deleteSelectedNode(): Promise<void> {
    await this.page.keyboard.press('Delete')
    // Or Backspace
    // await this.page.keyboard.press('Backspace')
  }

  /**
   * Delete a node by name using context menu
   */
  async deleteNode(name: string): Promise<void> {
    await this.node(name).click({ button: 'right' })
    await this.page.getByRole('menuitem', { name: /delete|删除/i }).click()
  }

  /**
   * Connect two nodes by dragging from source handle to target handle
   */
  async connectNodes(fromNode: string, toNode: string): Promise<void> {
    // ReactFlow uses data-handlepos for handle positions
    const sourceHandle = this.node(fromNode).locator('.react-flow__handle-right, [data-handlepos="right"]')
    const targetHandle = this.node(toNode).locator('.react-flow__handle-left, [data-handlepos="left"]')

    await sourceHandle.dragTo(targetHandle)
  }

  /**
   * Run/test the workflow (click Test Run button)
   */
  async runWorkflow(): Promise<void> {
    await this.runButton.click()
  }

  /**
   * Stop a running workflow
   */
  async stopWorkflow(): Promise<void> {
    await this.stopButton.click()
  }

  /**
   * Check if workflow is currently running
   */
  async isRunning(): Promise<boolean> {
    const text = await this.runButton.textContent()
    return text?.includes('Running') || text?.includes('Listening') || false
  }

  /**
   * Publish the workflow
   */
  async publishWorkflow(): Promise<void> {
    await this.publishButton.click()

    // Handle confirmation dialog if it appears
    const confirmButton = this.page.getByRole('button', { name: /confirm|确认/i })
    if (await confirmButton.isVisible({ timeout: 2000 }))
      await confirmButton.click()

    await this.expectSuccessToast()
  }

  /**
   * Wait for workflow run to complete (success or failure)
   */
  async waitForRunComplete(timeout = 60000): Promise<void> {
    // Wait until the "Running" state ends
    await expect(async () => {
      const isStillRunning = await this.isRunning()
      expect(isStillRunning).toBe(false)
    }).toPass({ timeout })
  }

  /**
   * Verify workflow run completed successfully
   */
  async expectRunSuccess(): Promise<void> {
    await this.waitForRunComplete()
    // Check for success indicators in the debug panel or toast
    const successIndicator = this.page.locator(':text("Succeeded"), :text("success"), :text("成功")')
    await expect(successIndicator).toBeVisible({ timeout: 10000 })
  }

  /**
   * Get the count of nodes on canvas
   */
  async getNodeCount(): Promise<number> {
    return this.canvas.locator('.react-flow__node').count()
  }

  /**
   * Verify a specific node exists on canvas
   */
  async expectNodeExists(name: string): Promise<void> {
    await expect(this.node(name)).toBeVisible()
  }

  /**
   * Verify a specific node does not exist on canvas
   */
  async expectNodeNotExists(name: string): Promise<void> {
    await expect(this.node(name)).not.toBeVisible()
  }

  /**
   * Zoom in the canvas
   */
  async zoomIn(): Promise<void> {
    // Use keyboard shortcut Ctrl++
    await this.page.keyboard.press('Control++')
  }

  /**
   * Zoom out the canvas
   */
  async zoomOut(): Promise<void> {
    // Use keyboard shortcut Ctrl+-
    await this.page.keyboard.press('Control+-')
  }

  /**
   * Fit view to show all nodes (keyboard shortcut Ctrl+1)
   */
  async fitView(): Promise<void> {
    await this.page.keyboard.press('Control+1')
  }

  /**
   * Get current zoom percentage
   */
  async getZoomPercentage(): Promise<number> {
    const text = await this.zoomPercentage.textContent()
    return Number.parseInt(text?.replace('%', '') || '100')
  }

  /**
   * Undo last action (Ctrl+Z)
   */
  async undo(): Promise<void> {
    await this.page.keyboard.press('Control+z')
  }

  /**
   * Redo last undone action (Ctrl+Shift+Z)
   */
  async redo(): Promise<void> {
    await this.page.keyboard.press('Control+Shift+z')
  }

  /**
   * Open version history panel
   */
  async openVersionHistory(): Promise<void> {
    await this.historyButton.click()
    await expect(this.versionHistoryPanel).toBeVisible()
  }

  /**
   * Duplicate selected node (Ctrl+D)
   */
  async duplicateSelectedNode(): Promise<void> {
    await this.page.keyboard.press('Control+d')
  }

  /**
   * Copy selected node (Ctrl+C)
   */
  async copySelectedNode(): Promise<void> {
    await this.page.keyboard.press('Control+c')
  }

  /**
   * Paste node (Ctrl+V)
   */
  async pasteNode(): Promise<void> {
    await this.page.keyboard.press('Control+v')
  }
}
