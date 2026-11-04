/**
 * @fileoverview ErrorBoundary component for React.
 * This component was extracted from the main markdown renderer.
 * It catches JavaScript errors anywhere in its child component tree,
 * logs those errors, and displays a fallback UI instead of the crashed component tree.
 * Primarily used around complex rendering logic like ECharts or SVG within Markdown.
 */
import * as React from 'react'
import { Component } from 'react'
// **Add an ECharts runtime error handler
// Avoid error #7832 (Crash when ECharts accesses undefined objects)
// This can happen when a component attempts to access an undefined object that references an unregistered map, causing the program to crash.

export default class ErrorBoundary extends Component<
  React.PropsWithChildren,
  { hasError: boolean }
> {
  constructor(props: React.PropsWithChildren) {
    super(props)
    this.state = { hasError: false }
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ hasError: true })
    console.error(error, errorInfo)
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div>
          Oops! An error occurred. This could be due to an ECharts runtime error or invalid SVG
          content.
          <br />
          (see the browser console for more information)
        </div>
      )
    }
    return this.props.children
  }
}
