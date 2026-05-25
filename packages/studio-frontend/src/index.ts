/**
 * @dify/studio-frontend
 *
 * Studio frontend package for Dify platform.
 * Contains workflow editor, app management, and related UI components.
 *
 * Phase 1: Re-exports from web app components.
 * Phase 2: Components physically moved to this package.
 */

// App management
export { default as Apps } from './apps'

// App detail
export * from './app'

// Workflow editor
export * from './workflow'

// Workflow app wrapper
export * from './workflow-app'

// App sidebar
export * from './app-sidebar'

// Develop / API access
export * from './develop'
