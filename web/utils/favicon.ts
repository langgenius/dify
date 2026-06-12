type RuntimeFaviconKind = 'document' | 'app'

const runtimeFaviconAttribute = 'data-dify-runtime-favicon'
const runtimeAppleTouchIconAttribute = 'data-dify-runtime-apple-touch-icon'

type RuntimeFaviconOptions = {
  appleTouchIconHref?: string
  type?: string
}

function getRuntimeFaviconSelector(kind: RuntimeFaviconKind) {
  return `link[${runtimeFaviconAttribute}="${kind}"]`
}

function getRuntimeAppleTouchIconSelector(kind: RuntimeFaviconKind) {
  return `link[${runtimeAppleTouchIconAttribute}="${kind}"]`
}

function removeRuntimeLinks(selector: string) {
  document.head
    .querySelectorAll<HTMLLinkElement>(selector)
    .forEach(link => link.remove())
}

function upsertHeadLink(selector: string, attribute: string, kind: RuntimeFaviconKind) {
  const existing = document.head.querySelector<HTMLLinkElement>(selector)
  if (existing)
    return existing

  const link = document.createElement('link')
  link.setAttribute(attribute, kind)
  document.head.appendChild(link)
  return link
}

export function clearRuntimeFavicon(kind: RuntimeFaviconKind) {
  removeRuntimeLinks(getRuntimeFaviconSelector(kind))
  removeRuntimeLinks(getRuntimeAppleTouchIconSelector(kind))
}

export function setRuntimeFavicon(
  kind: RuntimeFaviconKind,
  href: string,
  options: RuntimeFaviconOptions = {},
) {
  if (!href) {
    clearRuntimeFavicon(kind)
    return
  }

  const icon = upsertHeadLink(
    getRuntimeFaviconSelector(kind),
    runtimeFaviconAttribute,
    kind,
  )
  icon.rel = 'shortcut icon'
  icon.href = href

  if (options.type)
    icon.type = options.type
  else
    icon.removeAttribute('type')

  if (options.appleTouchIconHref === undefined)
    return

  if (!options.appleTouchIconHref) {
    removeRuntimeLinks(getRuntimeAppleTouchIconSelector(kind))
    return
  }

  const apple = upsertHeadLink(
    getRuntimeAppleTouchIconSelector(kind),
    runtimeAppleTouchIconAttribute,
    kind,
  )
  apple.rel = 'apple-touch-icon'
  apple.href = options.appleTouchIconHref
}
