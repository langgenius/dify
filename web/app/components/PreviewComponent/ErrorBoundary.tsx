import React from 'react'

class ErrorBoundary extends React.Component<
{ children: React.ReactNode },
{ hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            color: 'red',
            padding: '10px',
            border: '1px solid red',
            borderRadius: '4px',
          }}
        >
          <h3>Runtime Error:</h3>
          <pre>{this.state.error?.message}</pre>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
