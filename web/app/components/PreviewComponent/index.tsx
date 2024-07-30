import React, { useEffect, useState } from 'react'
import ErrorBoundary from './ErrorBoundary'
import compileCodeToComponent from './compileCode'

const PreviewComponent = ({ code }: { code: string }) => {
  const [component, setComponent] = useState<React.ComponentType | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    const compileAndRender = async () => {
      try {
        const ComponentToRender = await compileCodeToComponent(code)
        if (typeof ComponentToRender === 'function') {
          if (isMounted) {
            setComponent(() => ComponentToRender)
            setError(null)
          }
        }
        else {
          if (isMounted)
            setError('The code did not export a valid React component.')
        }
      }
      catch (err: any) {
        console.error('Error transpiling or evaluating code:', err)
        if (isMounted) {
          setError(
            err.message || 'An error occurred while rendering the component.',
          )
        }
      }
    }

    compileAndRender()

    return () => {
      isMounted = false
    }
  }, [code])

  if (error) {
    return (
      <div
        style={{
          color: 'red',
          padding: '10px',
          border: '1px solid red',
          borderRadius: '4px',
        }}
      >
        <h3>Compilation Error:</h3>
        <pre>{error}</pre>
      </div>
    )
  }

  return (
    <ErrorBoundary>
      {component ? React.createElement(component) : <div>Loading...</div>}
    </ErrorBoundary>
  )
}

export default PreviewComponent
