'use client'

import type { DiffyAgent } from './client'
import { Button } from '@langgenius/dify-ui/button'
import { toast } from '@langgenius/dify-ui/toast'
import { useState } from 'react'
import { downloadBlob } from '@/utils/download'
import { absoluteBackendUrl } from './client'

const BACKEND_URL_MARKER = 'const BACKEND_URL = "";'
const IFRAME_URL_PLACEHOLDER = 'https://your-dify-domain/chatbot/<token>'

function scriptTag(backend: string) {
  return `<script src="${backend}/widget.min.js" data-backend="${backend}"></script>`
}

function iframeTag(iframeUrl: string) {
  return [
    '<iframe',
    `  src="${iframeUrl}"`,
    '  style="width: 100%; height: 700px; border: 0; border-radius: 12px;"',
    '  allow="microphone"',
    '></iframe>',
  ].join('\n')
}

function scriptExamplePage(backend: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Chat widget example</title>
</head>
<body>
  <h1>My website</h1>
  <p>The chat bubble appears in the bottom-right corner.</p>

  <!-- Paste this just before </body> on every page that should show the chat. -->
  ${scriptTag(backend)}
</body>
</html>
`
}

function iframeExamplePage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Chat iframe example</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; }
    iframe { width: 100%; height: 100vh; border: none; }
  </style>
</head>
<body>
  <!-- chat.html is the full-page chat you downloaded. Keep it next to this file. -->
  <iframe src="chat.html"></iframe>
</body>
</html>
`
}

function downloadHtml(html: string, fileName: string) {
  downloadBlob({ data: new Blob([html], { type: 'text/html' }), fileName })
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success('Copied')
  } catch {
    toast.error('Could not copy. Select the text and copy it by hand.')
  }
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <div className="relative rounded-lg border-[0.5px] border-divider-regular bg-background-section-burn">
      <pre className="overflow-x-auto p-3 pr-20 font-mono system-xs-regular text-text-secondary">
        <code>{code}</code>
      </pre>
      <div className="absolute top-2 right-2">
        <Button
          size="small"
          variant="secondary"
          aria-label={`Copy ${label}`}
          onClick={() => void copyText(code)}
        >
          Copy
        </Button>
      </div>
    </div>
  )
}

function Inline({ children }: { children: string }) {
  return (
    <code className="rounded bg-background-section-burn px-1 py-0.5 font-mono system-xs-regular text-text-secondary">
      {children}
    </code>
  )
}

export function EmbedGuide({ agents }: { agents: DiffyAgent[] }) {
  const [backend] = useState(() => (typeof window === 'undefined' ? '' : absoluteBackendUrl()))
  const [downloadingChat, setDownloadingChat] = useState(false)

  if (!backend) return null

  const iframeUrl = agents[0]?.iframe_url ?? IFRAME_URL_PLACEHOLDER
  const isPlainHttp = backend.startsWith('http://')

  const handleDownloadChat = async () => {
    if (downloadingChat) return
    setDownloadingChat(true)

    try {
      const res = await fetch(`${backend}/chat.html`)
      if (!res.ok) throw new Error(`chat.html request failed: ${res.status}`)

      const html = await res.text()
      if (html.includes(BACKEND_URL_MARKER)) {
        downloadHtml(
          html.replace(BACKEND_URL_MARKER, `const BACKEND_URL = ${JSON.stringify(backend)};`),
          'chat.html',
        )
      } else {
        downloadHtml(html, 'chat.html')
        toast.warning('Downloaded, but set BACKEND_URL inside the file yourself.')
      }
    } catch {
      toast.error('Could not download chat.html from the backend.')
    } finally {
      setDownloadingChat(false)
    }
  }

  return (
    <section className="flex flex-col gap-5 rounded-xl border-[0.5px] border-divider-regular bg-components-card-bg p-5 shadow-xs shadow-shadow-shadow-3">
      <div className="flex flex-col gap-2">
        <h2 className="system-md-semibold text-text-primary">Add the chat to a website</h2>
        <ol className="flex list-decimal flex-col gap-1 pl-5 system-sm-regular text-text-secondary">
          <li>
            Save the website in the <strong>Add agent</strong> form below, using its{' '}
            <strong>full address</strong> with <Inline>https://</Inline>, for example{' '}
            <Inline>https://customer.com</Inline> or <Inline>https://customer.com/support</Inline>,
            plus the Diffy iframe URL for that site.
          </li>
          <li>
            Paste the script from Option 1 into the website, just before <Inline>{'</body>'}</Inline>
            .
          </li>
          <li>
            Reload the website. A chat bubble appears in the bottom-right corner and opens the
            chat you saved for that address.
          </li>
        </ol>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="system-sm-semibold text-text-primary">Option 1: script (recommended)</h3>
        <p className="system-xs-regular text-text-tertiary">
          One snippet works on every site. The backend picks the right chat from the address of the
          page it is loaded on.
        </p>
        <CodeBlock code={scriptTag(backend)} label="script snippet" />
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="system-sm-semibold text-text-primary">Option 2: plain iframe</h3>
        <p className="system-xs-regular text-text-tertiary">
          Shows one fixed chat. Use the Diffy iframe URL of that site
          {agents.length > 0 ? ' (filled in from your first saved agent)' : ''}.
        </p>
        <CodeBlock code={iframeTag(iframeUrl)} label="iframe snippet" />
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="system-sm-semibold text-text-primary">Option 3: full-page chat and examples</h3>
        <p className="system-xs-regular text-text-tertiary">
          <Inline>chat.html</Inline> is a full-page chat. Host it on the customer website itself
          (it picks the chat from the address it is opened at, so save that address as the
          hostname of the agent), then embed it with the iframe example. The script example is a
          complete page with the Option 1 snippet already in it.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="small"
            variant="secondary"
            loading={downloadingChat}
            onClick={() => void handleDownloadChat()}
          >
            Download full-page chat (chat.html)
          </Button>
          <Button
            size="small"
            variant="secondary"
            onClick={() => downloadHtml(iframeExamplePage(), 'example.html')}
          >
            Download iframe example (example.html)
          </Button>
          <Button
            size="small"
            variant="secondary"
            onClick={() => downloadHtml(scriptExamplePage(backend), 'widget-example.html')}
          >
            Download script example (widget-example.html)
          </Button>
        </div>
      </div>

      <ul className="flex list-disc flex-col gap-1 pl-5 system-xs-regular text-text-tertiary">
        {isPlainHttp && (
          <li className="text-text-warning-secondary">
            This Dify site is on plain <Inline>http://</Inline>, so websites that use{' '}
            <Inline>https://</Inline> will block the chat. Serve Dify over HTTPS to use it there.
          </li>
        )}
        <li>
          A hostname without <Inline>https://</Inline> (like <Inline>customer.com</Inline>) only
          matches when <Inline>ENABLE_HOSTNAME_FALLBACK=true</Inline> is set on the backend.
        </li>
        <li>
          If the chat area stays blank, the Diffy iframe URL may not allow being embedded, or the
          address you saved does not match the page.
        </li>
      </ul>
    </section>
  )
}
