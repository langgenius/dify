import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Script } from 'node:vm'
import { waitFor } from '@testing-library/react'

const embedArtifacts = [
  {
    name: 'embed.js',
    source: readFileSync(resolve(process.cwd(), 'public/embed.js'), 'utf8'),
  },
  {
    name: 'embed.min.js',
    source: readFileSync(resolve(process.cwd(), 'public/embed.min.js'), 'utf8'),
  },
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
