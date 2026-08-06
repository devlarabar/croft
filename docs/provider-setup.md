# Setting up Azure OpenAI and AWS Bedrock

Croft can run against Azure-hosted OpenAI models and Bedrock-hosted Claude
models. Both are pay-per-token with no standing cost. This is the one-time
cloud-side setup; afterwards you paste the credentials into Croft's
**Models** page and set the active model.

## Azure OpenAI

You need an Azure account with a subscription.

1. **Create the resource.** In the [Azure portal](https://portal.azure.com),
   search for "Azure OpenAI" → Create. Pick a subscription, a resource
   group, a region, and a name. The **name is the "resource name"** you'll
   paste into Croft (the `myname` in `myname.openai.azure.com`). Pick a
   region that carries the models you want — check the
   [model availability table](https://learn.microsoft.com/en-us/azure/ai-services/openai/concepts/models)
   (`eastus2` and `swedencentral` are usually well-stocked).
2. **Deploy the models.** Open the resource → "Go to Azure AI Foundry
   portal" → **Deployments** → Deploy model. Deploy each model you want
   (e.g. `gpt-5`, `gpt-4.1`).
   **Name each deployment exactly after the model** — `gpt-5`, not
   `gpt-5-prod`. Croft sends the model name as the deployment name, so a
   mismatch means 404s. "Global Standard" deployment type is fine.
3. **Get the key.** Back in the Azure portal, resource → **Keys and
   Endpoint** → copy Key 1.
4. **Paste into Croft.** Models page → azure section → enter the key and
   the resource name → Save credentials. Then set the active model.

If runs hit 429s, raise the deployment's tokens-per-minute quota in AI
Foundry → Quotas.

## AWS Bedrock

You need an AWS account.

1. **Pick a region and enable model access.** Open the
   [Bedrock console](https://console.aws.amazon.com/bedrock), make sure the
   region selector (top right) shows the region you want (`us-east-1` gets
   new models first). Go to **Model access** → Modify model access → tick
   the Anthropic Claude models → submit. Anthropic asks for a short
   use-case form; approval is usually immediate. Access is per-region.
2. **Create an IAM user.** [IAM console](https://console.aws.amazon.com/iam)
   → Users → Create user (no console access needed) → "Attach policies
   directly" → Create policy → JSON tab → paste:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
       "Resource": "*"
     }]
   }
   ```

   Name it (e.g. `croft-bedrock-invoke`), attach it, finish creating the
   user.
3. **Create an access key.** The user → Security credentials → Create
   access key → "Third-party service" → copy the **Access key ID** and
   **Secret access key** (the secret is shown only once).
4. **Paste into Croft.** Models page → bedrock section → access key ID,
   secret access key, and region → Save credentials. Then set the active
   model.

Croft's model list uses cross-region inference profile IDs
(`us.anthropic.…`), which work from any US region; if you set up in an EU
region instead, the IDs need an `eu.` prefix — that's a code change in
`packages/core/src/llm/adapters/bedrock.ts`.

## Recommended for both

Set a spending alert — AWS Budgets / Azure Cost Management. Croft runs
send screenshots on every agent turn, so token usage adds up.
