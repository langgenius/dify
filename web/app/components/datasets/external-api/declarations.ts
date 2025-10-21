export type CreateExternalAPIReq = {
  name: string
  settings: {
    endpoint: string
    api_key: string
  }
}

export type FormSchema = {
  variable: string
  type: 'text' | 'secret'
  label: {
    [key: string]: string
  }
  required: boolean
}
