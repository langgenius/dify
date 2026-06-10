'use client'
import type { ZodSchema } from 'zod'
import * as React from 'react'

function withValidation<T extends Record<string, unknown>, K extends keyof T>(
  WrappedComponent: React.ComponentType<T>,
  schema: ZodSchema<Pick<T, K>>,
) {
  return function EnsuredComponent(props: T) {
    const partialProps = Object.fromEntries(
      Object.entries(props).filter(([key]) => key in (schema._def as any).shape),
    ) as Pick<T, K>

    const checkRes = schema.safeParse(partialProps)
    if (!checkRes.success) {
      console.error(checkRes.error)
      // Maybe there is a better way to handle this, like error logic placeholder
      return null
    }
    return <WrappedComponent {...props} />
  }
}

export default withValidation
