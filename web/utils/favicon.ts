type RuntimeFaviconKind = 'document' | 'app'

const runtimeFaviconAttribute = 'data-dify-runtime-favicon'
const runtimeAppleTouchIconAttribute = 'data-dify-runtime-apple-touch-icon'

type RuntimeFaviconOptions = {
  appleTouchIconHref?: string
  type?: string
}

const getRuntimeFaviconSelector = (kind: RuntimeFaviconKind) =>
  `link[${runtimeFaviconAttribute}="${kind}"]`

const getRuntimeAppleTouchIconSelector = (kind: RuntimeFaviconKind) =>
  `link[${runtimeAppleTouchIconAttribute}="${kind}"]`

const removeRuntimeLinks = (selector: string) => {
  document.head
    .querySelectorAll<HTMLLinkElement>(selector)
    .forEach(link => link.remove())
}

const upsertHeadLink = (selector: string, attribute: string, kind: RuntimeFaviconKind) => {
  const existing = document.head.querySelector<HTMLLinkElement>(selector)
  if (existing)
    return existing

  const link = document.createElement('link')
  link.setAttribute(attribute, kind)
  document.head.appendChild(link)
  return link
}

export const clearRuntimeFavicon = (kind: RuntimeFaviconKind) => {
  removeRuntimeLinks(getRuntimeFaviconSelector(kind))
  removeRuntimeLinks(getRuntimeAppleTouchIconSelector(kind))
}

export const setRuntimeFavicon = (
  kind: RuntimeFaviconKind,
  href: string,
  options: RuntimeFaviconOptions = {},
) => {
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
