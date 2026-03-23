// Auto-generated from i18n-config/i18next-config.ts
// Keep in sync with the namespaces object

// @keep-sorted
export const NAMESPACES = [
  'app',
  'appAnnotation',
  'appApi',
  'appDebug',
  'appLog',
  'appOverview',
  'billing',
  'common',
  'custom',
  'dataset',
  'datasetCreation',
  'datasetDocuments',
  'datasetHitTesting',
  'datasetPipeline',
  'datasetSettings',
  'education',
  'explore',
  'layout',
  'login',
  'oauth',
  'pipeline',
  'plugin',
  'pluginTags',
  'pluginTrigger',
  'register',
  'runLog',
  'share',
  'time',
  'tools',
  'workflow',
]

// Sort by length descending to match longer prefixes first
// e.g., 'datasetDocuments' before 'dataset'
export const NAMESPACES_BY_LENGTH = [...NAMESPACES].sort((a, b) => b.length - a.length)

/**
 * Extract namespace from a translation key
 * Returns null if no namespace prefix found or if already in namespace:key format
 * @param {string} key
 * @returns {{ ns: string, localKey: string } | null}
 */
export function extractNamespace(key) {
  // Skip if already in namespace:key format
  for (const ns of NAMESPACES_BY_LENGTH) {
    if (key.startsWith(`${ns}:`)) {
      return null
    }
  }
  // Check for legacy namespace.key format
  for (const ns of NAMESPACES_BY_LENGTH) {
    if (key.startsWith(`${ns}.`)) {
      return { ns, localKey: key.slice(ns.length + 1) }
    }
  }
  return null
}

/**
 * Remove namespace prefix from a string value
 * Used for fixing variable declarations
 * @param {string} value
 * @returns {{ ns: string, newValue: string } | null}
 */
export function removeNamespacePrefix(value) {
  // Skip if already in namespace:key format
  for (const ns of NAMESPACES_BY_LENGTH) {
    if (value.startsWith(`${ns}:`)) {
      return null
    }
  }
  // Check for legacy namespace.key format
  for (const ns of NAMESPACES_BY_LENGTH) {
    if (value.startsWith(`${ns}.`)) {
      return { ns, newValue: value.slice(ns.length + 1) }
    }
    if (value === ns) {
      return { ns, newValue: '' }
    }
  }
  return null
}
