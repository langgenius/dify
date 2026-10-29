export type HumanInputFormRoute =
  | { kind: 'legacy'; token: string }
  | { kind: 'v2'; token: string }
  | { kind: 'non-form' }

export const classifyHumanInputFormRoute = (pathname: string): HumanInputFormRoute => {
  const match = pathname.match(/(?:^|\/)(form|form-v2)\/([^/]+)\/?$/)
  if (!match) return { kind: 'non-form' }

  const [, route, token] = match
  if (!token) return { kind: 'non-form' }

  return {
    kind: route === 'form-v2' ? 'v2' : 'legacy',
    token,
  }
}
