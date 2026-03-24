/**
 * Re-exports context-menu floating hook without importing from the restricted
 * `portal-to-follow-elem/use-context-menu-floating` path at call sites.
 */
export {
  type Position,
  useContextMenuFloating,
  type UseContextMenuFloatingOptions,
} from '../portal-to-follow-elem/use-context-menu-floating'
