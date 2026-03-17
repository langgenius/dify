import { headers } from 'next/headers'
import { env } from '@/env'
import { MODERN_MONACO_IMPORT_MAP } from './hoisted-config'

function withBasePath(pathname: string) {
  return `${env.NEXT_PUBLIC_BASE_PATH}${pathname}`
}

function getRequestOrigin(requestHeaders: Headers) {
  const protocol = requestHeaders.get('x-forwarded-proto') ?? 'http'
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host')
  if (!host)
    return null
  return `${protocol}://${host}`
}

const MonacoImportMap = async () => {
  const requestHeaders = await headers()
  const nonce = process.env.NODE_ENV === 'production' ? requestHeaders.get('x-nonce') ?? '' : ''
  const requestOrigin = getRequestOrigin(requestHeaders)
  const importMap = JSON.stringify({
    imports: Object.fromEntries(
      Object.entries(MODERN_MONACO_IMPORT_MAP).map(([specifier, pathname]) => {
        const modulePath = withBasePath(pathname)
        const moduleUrl = requestOrigin ? new URL(modulePath, requestOrigin).toString() : modulePath
        return [specifier, moduleUrl]
      }),
    ),
  })

  return (
    <script nonce={nonce || undefined} type="importmap" data-modern-monaco-importmap="">
      {importMap}
    </script>
  )
}

export default MonacoImportMap
