import type { SearchResult } from './types'

import { useCallback, useMemo, useSyncExternalStore } from 'react'

export type ScopeContext = {
  isWorkflowPage: boolean
  isRagPipelinePage: boolean
  isAdmin?: boolean
}

export type ScopeSearchHandler = (
  query: string,
  searchTerm: string,
  locale?: string,
) => Promise<SearchResult[]> | SearchResult[]

export type ScopeDescriptor = {
  /**
   * Unique identifier for the scope (e.g. 'app', 'plugin')
   */
  id: string
  /**
   * Shortcut to trigger this scope (e.g. '@app')
   */
  shortcut: string
  /**
   * Additional shortcuts that map to this scope (e.g. ['@kb'])
   */
  aliases?: string[]
  /**
   * I18n key or string for the scope title
   */
  title: string
  /**
   * Description for help text
   */
  description: string
  /**
   * Search handler function
   */
  search: ScopeSearchHandler
  /**
   * Predicate to check if this scope is available in current context
   */
  isAvailable?: (context: ScopeContext) => boolean
}

type Listener = () => void

class ScopeRegistry {
  private scopes: Map<string, ScopeDescriptor> = new Map()
  private listeners: Set<Listener> = new Set()
  private version = 0

  register(scope: ScopeDescriptor) {
    this.scopes.set(scope.id, scope)
    this.notify()
  }

  unregister(id: string) {
    if (this.scopes.delete(id))
      this.notify()
  }

  getScope(id: string) {
    return this.scopes.get(id)
  }

  getScopes(context: ScopeContext): ScopeDescriptor[] {
    return Array.from(this.scopes.values())
      .filter(scope => !scope.isAvailable || scope.isAvailable(context))
      .sort((a, b) => a.shortcut.localeCompare(b.shortcut))
  }

  updateSearchHandler(id: string, search: ScopeSearchHandler) {
    const scope = this.scopes.get(id)
    if (!scope)
      return
    this.scopes.set(id, { ...scope, search })
    this.notify()
  }

  getVersion() {
    return this.version
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify() {
    this.version += 1
    this.listeners.forEach(listener => listener())
  }
}

export const scopeRegistry = new ScopeRegistry()

export const useScopeRegistry = (context: ScopeContext) => {
  const subscribe = useCallback(
    (listener: Listener) => scopeRegistry.subscribe(listener),
    [],
  )

  const getSnapshot = useCallback(
    () => scopeRegistry.getVersion(),
    [],
  )

  const version = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  )

  return useMemo(
    () => scopeRegistry.getScopes(context),
    [version, context.isWorkflowPage, context.isRagPipelinePage, context.isAdmin],
  )
}
