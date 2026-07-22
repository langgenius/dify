import { readFile } from "node:fs/promises";

import {
  type RetrievalRegressionEvaluationInput,
  type RetrievalRegressionThresholds,
  createRetrievalRegressionGate,
} from "../src/retrieval-regression";

interface RegressionGateFile extends RetrievalRegressionEvaluationInput {
  readonly thresholds: RetrievalRegressionThresholds;
}

const reportPath = process.argv[2] ?? ".harness/evaluation/retrieval-regression-report.json";
const raw = await readFile(reportPath, "utf8");
const input = JSON.parse(raw) as RegressionGateFile;
const result = createRetrievalRegressionGate(input.thresholds).evaluate({
  baseline: input.baseline,
  current: input.current,
});

if (!result.passed) {
  console.error(`Retrieval regression gate failed for ${reportPath}`);

  for (const failure of result.failures) {
    console.error(`- ${failure}`);
  }

  process.exitCode = 1;
} else {
  const advancedMetrics = [
    input.current.citationAccuracy !== undefined
      ? `citationAccuracy=${input.current.citationAccuracy.toFixed(3)}`
      : undefined,
    input.current.faithfulnessScore !== undefined
      ? `faithfulnessScore=${input.current.faithfulnessScore.toFixed(3)}`
      : undefined,
  ].filter((metric): metric is string => metric !== undefined);

  console.log(
    [
      `Retrieval regression gate passed: recallAtK=${input.current.recallAtK.toFixed(3)}`,
      `citationHitRate=${input.current.citationHitRate.toFixed(3)}`,
      `noAnswerRate=${input.current.noAnswerRate.toFixed(3)}`,
      ...advancedMetrics,
    ].join(", "),
  );
}
