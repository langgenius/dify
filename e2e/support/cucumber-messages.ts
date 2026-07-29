type CucumberMessage = {
  testCaseStarted?: unknown
}

export const countStartedCucumberScenarios = (contents: string) =>
  contents
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CucumberMessage)
    .filter((message) => message.testCaseStarted !== undefined).length

export const assertCucumberScenariosStarted = (contents: string) => {
  const started = countStartedCucumberScenarios(contents)

  if (started === 0)
    throw new Error('Cucumber selected zero scenarios. Check the active tag expression and paths.')
}
