import { createSerializer, parseAsStringLiteral } from 'nuqs'

export const demoSourceQueryParamName = 'source'

export const demoSourceQueryParser = parseAsStringLiteral(['notification'])

/** Builds a link to the demo; the in-site notification links to `notificationDemoHref`. */
export const collaborationDemoHref = createSerializer({
  [demoSourceQueryParamName]: demoSourceQueryParser,
})

export const notificationDemoHref = collaborationDemoHref('/collaboration-demo', {
  source: 'notification',
})
