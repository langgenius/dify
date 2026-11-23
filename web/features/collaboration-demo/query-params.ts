import { createSerializer, parseAsStringLiteral } from 'nuqs'

export const demoSearchParams = {
  source: parseAsStringLiteral(['notification']),
}

export const serializeDemoSearchParams = createSerializer(demoSearchParams)

/** The link the in-site notification's "View demo" action points to. */
export const notificationDemoHref = serializeDemoSearchParams('/collaboration-demo', {
  source: 'notification',
})
