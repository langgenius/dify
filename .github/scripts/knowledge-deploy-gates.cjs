// A workflow_run event is privileged: accept only trusted pushes and the exact tested revision.
module.exports = async function knowledgeDeployGates({ github, context, core, now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  const source = context.payload.workflow_run;
  const repository = `${context.repo.owner}/${context.repo.repo}`;
  const branch = 'deploy/konwledge';
  if (source?.event !== 'push' || source.conclusion !== 'success' || source.head_branch !== branch || source.head_repository?.full_name !== repository || !/^[0-9a-f]{40}$/.test(source.head_sha)) {
    throw new Error('Deployment requires a successful trusted branch push.');
  }
  const isCurrent = async () => {
    const { data } = await github.rest.repos.getBranch({ ...context.repo, branch });
    return data.commit.sha === source.head_sha;
  };
  const skip = () => {
    core.info('Skipping a superseded deployment revision.');
    core.setOutput('current', 'false');
  };
  if (!(await isCurrent())) return skip();
  const deadline = now() + 30 * 60 * 1000;
  while (now() < deadline) {
    const { data } = await github.rest.actions.listWorkflowRuns({
      ...context.repo, workflow_id: 'knowledge-fs-ci.yml', branch, event: 'push',
      head_sha: source.head_sha, per_page: 100,
    });
    const run = data.workflow_runs
      .filter((candidate) => candidate.head_sha === source.head_sha && candidate.head_branch === branch && candidate.event === 'push' && candidate.head_repository?.full_name === repository)
      .sort((a, b) => b.run_number - a.run_number || b.run_attempt - a.run_attempt)[0];
    if (run?.status === 'completed') {
      if (run.conclusion !== 'success') throw new Error(`KnowledgeFS CI did not succeed for ${source.head_sha}: ${run.conclusion}.`);
      if (!(await isCurrent())) return skip();
      core.info(`KnowledgeFS CI and image build succeeded for ${source.head_sha}.`);
      core.setOutput('current', 'true');
      return;
    }
    if (!(await isCurrent())) return skip();
    core.info(`Waiting for KnowledgeFS CI at ${source.head_sha}.`);
    await sleep(15000);
  }
  throw new Error(`Timed out waiting for KnowledgeFS CI for ${source.head_sha}.`);
};
