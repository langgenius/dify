import { Script } from 'node:vm'
import { waitFor } from '@testing-library/react'
// Raw imports keep the artifacts in the module graph, so `--changed` reruns this spec for them.
import embedSource from '../public/embed.js?raw'
import embedMinSource from '../public/embed.min.js?raw'

const embedArtifacts = [
  { name: 'embed.js', source: embedSource },
  { name: 'embed.min.js', source: embedMinSource },
]

function executeEmbedScript(source: string) {
  Object.defineProperty(window, 'difyChatbotConfig', {
    configurable: true,
    value: {
      token: 'test-token',
      baseUrl: 'about:blank',
      dynamicScript: true,
    },
  })

  new Script(source).runInThisContext()
}

describe.each(embedArtifacts)('$name', ({ source }) => {
  beforeEach(() => {
    document.head.replaceChildren()
    document.body.replaceChildren()
  })

  afterEach(() => {
    Reflect.deleteProperty(window, 'difyChatbotConfig')
    document.head.replaceChildren()
    document.body.replaceChildren()
  })

  it('should delegate clipboard-write permission to the chatbot iframe', async () => {
    executeEmbedScript(source)

    await waitFor(() => {
      const iframe = document.querySelector<HTMLIFrameElement>('#dify-chatbot-bubble-window')
      const permissions = iframe?.allow.split(';').map((permission) => permission.trim())

      expect(permissions).toContain('clipboard-write')
    })
  })
})
