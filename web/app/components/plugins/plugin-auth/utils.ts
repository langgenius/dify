export const transformFormSchemasSecretInput = (isPristineSecretInputNames: string[], values: Record<string, any>) => {
  const transformedValues: Record<string, any> = { ...values }

  isPristineSecretInputNames.forEach((name) => {
    if (transformedValues[name])
      transformedValues[name] = '[__HIDDEN__]'
  })

  return transformedValues
}
