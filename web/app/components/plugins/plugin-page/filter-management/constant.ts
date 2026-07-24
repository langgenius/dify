export type Tag = {
  id: string
  name: string
  type: string
  binding_count: number
}

export type Category = {
  name: 'model' | 'tool' | 'extension' | 'bundle'
  binding_count: number
}
