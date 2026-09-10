export function getStreamingOperationIds(document) {
  return Object.values(document.paths ?? {})
    .flatMap((pathItem) =>
      Object.values(pathItem).flatMap((operation) => {
        if (typeof operation !== 'object' || operation === null) return []
        const isEventStream = Object.entries(operation.responses ?? {}).some(
          ([status, response]) =>
            (status === '2XX' || /^2\d\d$/.test(status)) &&
            typeof response === 'object' &&
            response !== null &&
            'text/event-stream' in (response.content ?? {}),
        )
        return isEventStream && typeof operation.operationId === 'string'
          ? [operation.operationId]
          : []
      }),
    )
    .sort()
}
