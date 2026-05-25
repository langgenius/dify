/**
 * @dify/studio-frontend
 *
 * Studio frontend package for Dify platform.
 * Contains workflow editor, app management, and related UI components.
 *
 * Phase 1: Types and contracts are canonical here; component re-exports come next.
 * Phase 2: Components and services physically moved to this package.
 */

// Types — canonical home for Studio app-level enums & shapes
export * from './types'

// Contracts — canonical home for Studio API contract type definitions
export * from './contracts'

// App management
export * from './apps'

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

// Services
export * from './services'
