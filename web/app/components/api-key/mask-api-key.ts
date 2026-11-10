export function maskApiKey(token: string) {
  // Knowledge API list responses are already masked by the server.
  if (token.includes('...') || token === '***') return token
  return `${token.slice(0, 5)}...${token.slice(-4)}`
}
