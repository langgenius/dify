import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Script } from 'node:vm'

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

async function executeEmbedScript(source: string): Promise<HTMLIFrameElement | null> {
  Object.defineProperty(window, 'difyChatbotConfig', {
    configurable: true,
    value: {
      token: 'test-token',
      baseUrl: 'https://dify.example.com',
      dynamicScript: true,
    },
  })

  new Script(source).runInThisContext()
  await new Promise<void>(resolve => window.setTimeout(resolve, 0))

  return document.querySelector<HTMLIFrameElement>('#dify-chatbot-bubble-window')
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
    const iframe = await executeEmbedScript(source)
    const permissions = iframe?.allow.split(';').map(permission => permission.trim())

    expect(permissions).toContain('clipboard-write')
  })
})
