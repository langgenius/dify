export type SearchParams = Record<string, string | string[] | undefined>

export const firstSearchParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value

export const searchParamsToString = (searchParams: SearchParams) => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === 'string')
      params.set(key, value)
    else if (Array.isArray(value))
      value.forEach(v => params.append(key, v))
  }
  const text = params.toString()
  return text ? `?${text}` : ''
}
