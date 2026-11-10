import type { Page } from '@playwright/test'
import type { Buffer } from 'node:buffer'

type Fault = 'upload' | 'acknowledgement'

function socketPacket(data: string | Buffer) {
  if (typeof data !== 'string') return
  const match = /^4(?:[56]\d+-|[23])(\d+)(\[.*\])$/s.exec(data)
  if (!match) return
  const payload: unknown = JSON.parse(match[2]!)
  if (Array.isArray(payload)) return { id: match[1]!, payload }
}

export async function observeWorkflowDraftNetwork(page: Page) {
  let fault: Fault | undefined
  let offline = false
  let faultObserved = false
  let socketCount = 0
  let confirmedUploads = 0
  let confirmedSyncs = 0
  const httpSaves: number[] = []

  page.on('response', (response) => {
    const request = response.request()
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/workflows/draft'))
      httpSaves.push(response.status())
  })

  await page.routeWebSocket(/\/socket\.io\//, (client) => {
    socketCount += 1
    if (offline) {
      void client.close({ code: 1011 })
      return
    }

    const server = client.connectToServer()
    const uploads = new Set<string>()
    const syncs = new Set<string>()
    let interrupted = false
    const interrupt = () => {
      offline = true
      interrupted = true
      faultObserved = true
      fault = undefined
      void client.close({ code: 1011 })
      void server.close({ code: 1011 })
    }

    client.onMessage((message) => {
      if (interrupted) return
      const packet = socketPacket(message)
      if (packet?.payload[0] === 'loro_draft_sync') {
        syncs.add(packet.id)
        const body: unknown = packet.payload[1]
        if (body && typeof body === 'object' && 'update' in body) {
          if (fault === 'upload') {
            interrupt()
            return
          }
          uploads.add(packet.id)
        }
      }
      server.send(message)
    })

    server.onMessage((message) => {
      if (interrupted) return
      const packet = socketPacket(message)
      if (packet && syncs.delete(packet.id) && packet.payload[1] === 200) {
        const upload = uploads.delete(packet.id)
        if (upload && fault === 'acknowledgement') {
          interrupt()
          return
        }
        confirmedSyncs += 1
        if (upload) confirmedUploads += 1
      }
      client.send(message)
    })
  })

  return {
    interruptNext: (next: Fault) => {
      fault = next
    },
    resume: () => {
      offline = false
    },
    faultObserved: () => faultObserved,
    socketCount: () => socketCount,
    confirmedUploads: () => confirmedUploads,
    confirmedSyncs: () => confirmedSyncs,
    httpSaves,
  }
}
