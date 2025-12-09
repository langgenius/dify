import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { BasePage } from './base.page'

/**
 * Apps (Studio) Page Object Model
 *
 * Handles interactions with the main apps listing page.
 * Based on: web/app/components/apps/list.tsx
 *          web/app/components/apps/new-app-card.tsx
 *          web/app/components/apps/app-card.tsx
 */
export class AppsPage extends BasePage {
  // Main page elements
  readonly createFromBlankButton: Locator
  readonly createFromTemplateButton: Locator
  readonly importDSLButton: Locator
  readonly searchInput: Locator
  readonly appGrid: Locator

  // Create app modal elements (from create-app-modal/index.tsx)
  readonly createAppModal: Locator
  readonly appNameInput: Locator
  readonly appDescriptionInput: Locator
  readonly createButton: Locator
  readonly cancelButton: Locator

  // App type selectors in create modal
  readonly chatbotType: Locator
  readonly completionType: Locator
  readonly workflowType: Locator
  readonly agentType: Locator
  readonly chatflowType: Locator

  // Delete confirmation
  readonly deleteConfirmButton: Locator

  constructor(page: Page) {
    super(page)

    // Create app card buttons (from new-app-card.tsx)
    // t('app.newApp.startFromBlank') = "Create from Blank"
    this.createFromBlankButton = page.getByRole('button', { name: 'Create from Blank' })
    // t('app.newApp.startFromTemplate') = "Create from Template"
    this.createFromTemplateButton = page.getByRole('button', { name: 'Create from Template' })
    // t('app.importDSL') = "Import DSL file"
    this.importDSLButton = page.getByRole('button', { name: /Import DSL/i })

    // Search input (from list.tsx)
    this.searchInput = page.getByPlaceholder(/search/i)

    // App grid container
    this.appGrid = page.locator('.grid').first()

    // Create app modal
    this.createAppModal = page.locator('[class*="fullscreen-modal"]').or(page.getByRole('dialog'))

    // App name input - placeholder: t('app.newApp.appNamePlaceholder') = "Give your app a name"
    this.appNameInput = page.getByPlaceholder('Give your app a name')

    // Description input - placeholder: t('app.newApp.appDescriptionPlaceholder') = "Enter the description of the app"
    this.appDescriptionInput = page.getByPlaceholder('Enter the description of the app')

    // Create button - t('app.newApp.Create') = "Create"
    this.createButton = page.getByRole('button', { name: 'Create', exact: true })
    this.cancelButton = page.getByRole('button', { name: 'Cancel' })

    // App type selectors (from create-app-modal)
    // These are displayed as clickable cards/buttons
    this.chatbotType = page.getByText('Chatbot', { exact: true })
    this.completionType = page.getByText('Completion', { exact: true }).or(page.getByText('Text Generator'))
    this.workflowType = page.getByText('Workflow', { exact: true })
    this.agentType = page.getByText('Agent', { exact: true })
    this.chatflowType = page.getByText('Chatflow', { exact: true })

    // Delete confirmation button
    this.deleteConfirmButton = page.getByRole('button', { name: /confirm|delete/i }).last()
  }

  get path(): string {
    return '/apps'
  }

  /**
   * Get app card by name
   * App cards use AppIcon and display the app name
   */
  appCard(name: string): Locator {
    return this.appGrid.locator(`div:has-text("${name}")`).first()
  }

  /**
   * Get app card's more menu button (three dots)
   */
  appCardMenu(name: string): Locator {
    return this.appCard(name).locator('svg[class*="ri-more"]').or(
      this.appCard(name).locator('button:has(svg)').last(),
    )
  }

  /**
   * Click "Create from Blank" button
   */
  async clickCreateFromBlank(): Promise<void> {
    await this.createFromBlankButton.click()
    await expect(this.createAppModal).toBeVisible({ timeout: 10000 })
  }

  /**
   * Click "Create from Template" button
   */
  async clickCreateFromTemplate(): Promise<void> {
    await this.createFromTemplateButton.click()
  }

  /**
   * Select app type in create modal
   */
  async selectAppType(type: 'chatbot' | 'completion' | 'workflow' | 'agent' | 'chatflow'): Promise<void> {
    const typeMap: Record<string, Locator> = {
      chatbot: this.chatbotType,
      completion: this.completionType,
      workflow: this.workflowType,
      agent: this.agentType,
      chatflow: this.chatflowType,
    }
    await typeMap[type].click()
  }

  /**
   * Fill app name
   */
  async fillAppName(name: string): Promise<void> {
    await this.appNameInput.fill(name)
  }

  /**
   * Fill app description
   */
  async fillAppDescription(description: string): Promise<void> {
    await this.appDescriptionInput.fill(description)
  }

  /**
   * Confirm app creation
   */
  async confirmCreate(): Promise<void> {
    await this.createButton.click()
  }

  /**
   * Create a new app with full flow
   */
  async createApp(options: {
    name: string
    type?: 'chatbot' | 'completion' | 'workflow' | 'agent' | 'chatflow'
    description?: string
  }): Promise<void> {
    const { name, type = 'chatbot', description } = options

    await this.clickCreateFromBlank()
    await this.selectAppType(type)
    await this.fillAppName(name)

    if (description)
      await this.fillAppDescription(description)

    await this.confirmCreate()

    // Wait for navigation to new app or modal to close
    await this.page.waitForURL(/\/app\//, { timeout: 30000 })
  }

  /**
   * Search for an app
   */
  async searchApp(query: string): Promise<void> {
    await this.searchInput.fill(query)
    await this.page.waitForTimeout(500) // Debounce
  }

  /**
   * Open an app by clicking its card
   */
  async openApp(name: string): Promise<void> {
    await this.appCard(name).click()
    await this.waitForNavigation()
  }

  /**
   * Delete an app by name
   */
  async deleteApp(name: string): Promise<void> {
    // Hover on app card to show menu
    await this.appCard(name).hover()

    // Click more menu (three dots icon)
    await this.appCardMenu(name).click()

    // Click delete in menu
    // t('common.operation.delete') = "Delete"
    await this.page.getByRole('menuitem', { name: 'Delete' })
      .or(this.page.getByText('Delete').last())
      .click()

    // Confirm deletion
    await this.deleteConfirmButton.click()

    // Wait for app to be removed
    await expect(this.appCard(name)).toBeHidden({ timeout: 10000 })
  }

  /**
   * Get count of visible apps
   */
  async getAppCount(): Promise<number> {
    // Each app card has the app icon and name
    return this.appGrid.locator('[class*="app-card"], [class*="rounded-xl"]').count()
  }

  /**
   * Check if apps list is empty
   */
  async isEmpty(): Promise<boolean> {
    // Empty state component is shown when no apps
    const emptyState = this.page.locator('[class*="empty"]')
    return emptyState.isVisible()
  }

  /**
   * Verify app exists
   */
  async expectAppExists(name: string): Promise<void> {
    await expect(this.page.getByText(name).first()).toBeVisible({ timeout: 10000 })
  }

  /**
   * Verify app does not exist
   */
  async expectAppNotExists(name: string): Promise<void> {
    await expect(this.page.getByText(name).first()).toBeHidden({ timeout: 10000 })
  }
}
