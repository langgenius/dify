declare module '*.mdx' {
  const MDXComponent: (props?: Record<string, unknown>) => JSX.Element
  export default MDXComponent
}
