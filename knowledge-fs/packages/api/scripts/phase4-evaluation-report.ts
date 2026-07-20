import { readFile } from "node:fs/promises";

import { type Phase4EvaluationInput, createPhase4EvaluationReport } from "../src/phase4-evaluation";

const reportPath = process.argv[2] ?? ".harness/evaluation/phase4-evaluation-report.json";
const raw = await readFile(reportPath, "utf8");
const input = JSON.parse(raw) as Phase4EvaluationInput;
const report = createPhase4EvaluationReport(input);

console.log(
  [
    `Phase 4 evaluation report: questions=${report.goldenSet.totalQuestions}`,
    `enrichedRecallDelta=${report.impact.enrichedVsBaseline.recallAtK.toFixed(3)}`,
    `summaryTreeRecallDelta=${report.impact.summaryTreeVsBaseline.recallAtK.toFixed(3)}`,
    `graphRecallDelta=${report.impact.graphExpandedVsBaseline.recallAtK.toFixed(3)}`,
  ].join(", "),
);
console.log(report.recommendation);
