import { collaborationDemoHref, notificationDemoHref } from '../query-params'

it('links the in-site notification to the demo with its source', () => {
  expect(notificationDemoHref).toBe('/collaboration-demo?source=notification')
  expect(collaborationDemoHref('/collaboration-demo', { source: null })).toBe('/collaboration-demo')
})
