import type { Page, WebSocketRoute } from '@playwright/test'

export async function observeWorkflowDraftNetwork(page: Page) {
  const connections = new Set<{ client: WebSocketRoute; server: WebSocketRoute }>()
  const httpSaves: number[] = []
  let offline = false
  let socketCount = 0

  page.on('response', (response) => {
    const request = response.request()
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/workflows/draft'))
      httpSaves.push(response.status())
  })

  await page.routeWebSocket(/\/socket\.io\//, async (client) => {
    socketCount += 1
    if (offline) {
      await client.close({ code: 1011 })
      return
    }
    const server = client.connectToServer()
    const connection = { client, server }
    connections.add(connection)
    client.onClose(async (code, reason) => {
      connections.delete(connection)
      await server.close({ code, reason })
    })
    server.onClose(async (code, reason) => {
      connections.delete(connection)
      await client.close({ code, reason })
    })
  })

  return {
    disconnect: async () => {
      offline = true
      const open = [...connections]
      connections.clear()
      await Promise.all(
        open.flatMap(({ client, server }) => [
          client.close({ code: 1011 }),
          server.close({ code: 1011 }),
        ]),
      )
    },
    resume: () => {
      offline = false
    },
    socketCount: () => socketCount,
    httpSaves,
  }
}

export type WorkflowDraftNetwork = Awaited<ReturnType<typeof observeWorkflowDraftNetwork>>
