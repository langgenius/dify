const STEP_SPLIT = '->'

/*
* : 1 -> 2 -> 3
* iteration: (iteration, 1, [2, 3]) -> 4.  (1, [2, 3]) means 1 is parent, [2, 3] is children
* parallel: 1 -> (parallel, [1,2,3], [4, (parallel: (6,7))]).
* retry: (retry, 1, [2,3]). 1 is parent, [2, 3] is retry nodes
*/
const simpleGraphToLogStruct = (input: string): any[] => {
  const list = input.split(STEP_SPLIT)
  return list
}

export default simpleGraphToLogStruct
