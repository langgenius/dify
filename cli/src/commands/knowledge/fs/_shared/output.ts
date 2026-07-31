export class KnowledgeFsOutput<T> {
  readonly response: T

  constructor(response: T) {
    this.response = response
  }

  text(): string {
    if (hasText(this.response)) return withTrailingNewline(this.response.text)

    return withTrailingNewline(JSON.stringify(this.response, null, 2))
  }

  json(): T {
    return this.response
  }
}

function hasText(value: unknown): value is { text: string } {
  return (
    typeof value === 'object' && value !== null && 'text' in value && typeof value.text === 'string'
  )
}

function withTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`
}
