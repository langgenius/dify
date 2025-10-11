export const buildProviderQuery = (collectionName: string): string => {
  const query = new URLSearchParams()
  query.set('provider', collectionName)
  return query.toString()
}
