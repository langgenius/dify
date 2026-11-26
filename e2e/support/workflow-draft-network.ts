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
      if (!connections.delete(connection)) return
      if (code === 1000 || (code !== undefined && code >= 3000 && code <= 4999))
        await server.close({ code, reason })
      else await server.close()
    })
    server.onClose(async (code, reason) => {
      if (connections.delete(connection)) await client.close({ code, reason })
    })
  })

  return {
    disconnect: async () => {
      const open = [...connections]
      if (!open.length) throw new Error('No collaboration WebSocket is open to disconnect.')
      offline = true
      connections.clear()
      await Promise.all(
        open.flatMap(({ client, server }) => [client.close({ code: 1011 }), server.close()]),
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
