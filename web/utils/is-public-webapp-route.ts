const PUBLIC_WEBAPP_ROUTE_PREFIXES = new Set([
  'agent',
  'chat',
  'chatbot',
  'completion',
  'workflow',
])

export const isPublicWebAppRoute = (pathname: string): boolean => {
  const firstSegment = pathname.split('/').filter(Boolean)[0]
  return firstSegment ? PUBLIC_WEBAPP_ROUTE_PREFIXES.has(firstSegment) : false
}
