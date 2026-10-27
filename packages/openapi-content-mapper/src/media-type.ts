/** Parameters belong in headers, but do not change the payload codec. */
export function mediaType(value: string): string {
  return (value.split(';', 1)[0] ?? '').trim().toLowerCase()
}

/** Parameter values can be case-sensitive even though type/subtype are not. */
export function mediaTypeKey(value: string): string {
  const separator = value.indexOf(';')
  return mediaType(value) + (separator < 0 ? '' : `;${value.slice(separator + 1).trim()}`)
}

type Whitespace = ' ' | '\t' | '\r' | '\n'
type Trim<S extends string> = S extends `${Whitespace}${infer Rest}`
  ? Trim<Rest>
  : S extends `${infer Rest}${Whitespace}`
    ? Trim<Rest>
    : S
export type MediaType<S extends string> = Lowercase<
  Trim<S extends `${infer Type};${string}` ? Type : S>
>
