const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  )

/**
 * Accepts a whole request copied from DevTools ("Copy as cURL"), a Cookie header,
 * or a bare cookie value, and returns the session cookie value.
 */
export const extractSessionCookieValue = (input: string, cookieName: string) => {
  const text = input.trim()
  const match = new RegExp(
    `(?<![\\w-])(?:__Host-|__Secure-)?${escapeRegExp(cookieName)}=([^;\\s'"&^]+)`,
  ).exec(text)
  if (match) return match[1]

  return /^[^\s;=]+$/.test(text) ? text : undefined
}

export const sessionImportPageResponse = (targetOrigin: string, error?: string, status = 200) =>
  new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Import session</title>
<style>
body { font: 14px/1.5 system-ui, sans-serif; max-width: 640px; margin: 48px auto; padding: 0 16px; }
textarea { box-sizing: border-box; width: 100%; height: 160px; font: 12px ui-monospace, monospace; }
button { margin-top: 12px; padding: 6px 16px; }
p[role="alert"] { color: #b42318; }
</style>
</head>
<body>
<h1>Import session</h1>
<ol>
<li>Sign in on <a href="${escapeHtml(targetOrigin)}" target="_blank" rel="noreferrer">${escapeHtml(targetOrigin)}</a>.</li>
<li>In DevTools → Network, right-click any API request → Copy → Copy as cURL.</li>
<li>Paste it below. The session is rotated on import, so the copied browser session stops refreshing.</li>
</ol>
${error ? `<p role="alert">${escapeHtml(error)}</p>` : ''}
<form method="post">
<textarea name="input" autofocus required placeholder="curl '${escapeHtml(targetOrigin)}/…' -b '…'"></textarea>
<button type="submit">Import</button>
</form>
</body>
</html>`,
    {
      status,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    },
  )
