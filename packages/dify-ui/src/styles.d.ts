declare module '*.css'

declare module '*.css?raw' {
  const content: string
  export default content
}
