// Raw fetch: we call exactly two Scaleway endpoints at runtime.
export async function startJob(env: Record<string, string>): Promise<string> {
  const res = await fetch(
    `https://api.scaleway.com/serverless-jobs/v1alpha1/regions/fr-par/job-definitions/${process.env.SCW_JOB_DEFINITION_ID}/start`,
    {
      method: "POST",
      headers: {
        "X-Auth-Token": process.env.SCW_SECRET_KEY!,
        "content-type": "application/json",
      },
      body: JSON.stringify({ environment_variables: env }),
    },
  );
  if (!res.ok) throw new Error(`Scaleway start job ${res.status}: ${await res.text()}`);
  const { job_runs } = (await res.json()) as { job_runs: { id: string }[] };
  return job_runs[0]!.id;
}

export async function stopJob(jobRunId: string): Promise<void> {
  const res = await fetch(
    `https://api.scaleway.com/serverless-jobs/v1alpha1/regions/fr-par/job-runs/${jobRunId}/stop`,
    { method: "POST", headers: { "X-Auth-Token": process.env.SCW_SECRET_KEY!, "content-type": "application/json" }, body: "{}" },
  );
  if (!res.ok) throw new Error(`Scaleway stop job ${res.status}: ${await res.text()}`);
}
