// Raw fetch: we call exactly one Scaleway endpoint at runtime.
export async function startJob(env: Record<string, string>): Promise<void> {
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
}
