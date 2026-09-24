import type { i18n, Resource } from 'i18next'

const eventName = 'dify:i18n-resources'

declare global {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- Augment the browser Window interface for the SSR resource transport.
  interface Window {
    __difyI18nResources?: Record<string, Resource>
  }
}

export function getStreamedResources(id: string): Resource {
  return typeof window === 'undefined' ? {} : (window.__difyI18nResources?.[id] ?? {})
}

export function mergeResources(initial: Resource, extra: Resource): Resource {
  const result = { ...initial }
  for (const [language, namespaces] of Object.entries(extra))
    result[language] = { ...result[language], ...namespaces }
  return result
}

export function subscribeToStreamedResources(id: string, instance: i18n) {
  const receive = () => {
    for (const [language, namespaces] of Object.entries(getStreamedResources(id))) {
      for (const [namespace, resource] of Object.entries(namespaces)) {
        if (!instance.hasResourceBundle(language, namespace))
          instance.addResourceBundle(language, namespace, resource)
      }
    }
  }
  window.addEventListener(eventName, receive)
  receive()
  return () => window.removeEventListener(eventName, receive)
}

export function createResourceCollector(instance: i18n, initial: Resource) {
  const sent = new Set(
    Object.entries(initial).flatMap(([language, namespaces]) =>
      Object.keys(namespaces).map((namespace) => `${language}/${namespace}`),
    ),
  )
  return () => {
    const resources: Resource = {}
    for (const namespace of instance.reportNamespaces?.getUsedNamespaces() ?? []) {
      for (const language of instance.languages) {
        const key = `${language}/${namespace}`
        if (sent.has(key) || !instance.hasResourceBundle(language, namespace)) continue
        ;(resources[language] ??= {})[namespace] = instance.getResourceBundle(language, namespace)
        sent.add(key)
      }
    }
    return resources
  }
}

export function serializeResourceUpdate(id: string, resources: Resource) {
  // Translation text must never terminate its enclosing script element.
  const payload = JSON.stringify([id, resources]).replace(
    /[<>&\u2028\u2029]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
  return `(()=>{const [id,resources]=${payload};const stores=window.__difyI18nResources??={};const store=stores[id]??={};for(const [language,namespaces] of Object.entries(resources)){Object.assign(store[language]??={},namespaces)}window.dispatchEvent(new Event('${eventName}'))})()`
}
