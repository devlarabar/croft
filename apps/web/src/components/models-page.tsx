import { Layout } from "../layout";
import type { ActiveModel, ProviderAdapter, schema } from "@croft/core";
import { fmtDate } from "../format-date";
import { Fieldset } from "./fieldset";
import { Button } from "./button";

interface ModelsPageProps {
  providers: ProviderAdapter[];
  creds: (typeof schema.credentials.$inferSelect)[];
  active: ActiveModel | null;
  notice?: string;
}

export function ModelsPage(props: ModelsPageProps) {
  return (
    <Layout title="Models">
      <h1>Models</h1>
      {props.notice ? <p>{props.notice}</p> : null}
      <Fieldset legend="Active model">
        <form method="post" action="/models/active">
          <select name="model" defaultValue={props.active ? `${props.active.providerId}/${props.active.model}` : undefined}>
            {props.providers.flatMap((provider) =>
              provider.models.map((model) => (
                <option
                  key={`${provider.id}/${model}`}
                  value={`${provider.id}/${model}`}
                >
                  {provider.id} / {model}
                </option>
              )),
            )}
          </select>{" "}
          <select name="credentialId" defaultValue={props.active?.credentialId}>
            {props.creds.map((cred) => (
              <option key={cred.id} value={cred.id}>
                {cred.providerId} {cred.kind} ({cred.id.slice(0, 8)}) — {fmtDate(cred.createdAt)}
              </option>
            ))}
          </select>{" "}
          <Button>Set active</Button>
        </form>
      </Fieldset>
      {props.providers.map((provider) => (
        <Fieldset key={provider.id} legend={provider.id}>
          <p>Models: {provider.models.join(", ")}</p>
          <form method="post" action="/models/credential">
            <input type="hidden" name="providerId" defaultValue={provider.id} />
            <input
              name="apiKey"
              type="password"
              placeholder={provider.id === "bedrock" ? "Access key ID" : "API key"}
              size={40}
            />{" "}
            {provider.id === "azure" ? (
              <input
                name="resourceName"
                placeholder="Resource name (the myname in myname.openai.azure.com)"
                size={46}
              />
            ) : null}
            {provider.id === "bedrock" ? (
              <>
                <input name="secretAccessKey" type="password" placeholder="Secret access key" size={40} />{" "}
                <input name="region" placeholder="Region" defaultValue="us-east-1" size={12} />
              </>
            ) : null}{" "}
            <Button>Save credentials</Button>
          </form>
          {provider.oauth ? (
            <p>
              <a href={`/oauth/start?provider=${provider.id}`}>Connect with OAuth</a>
            </p>
          ) : null}
        </Fieldset>
      ))}
    </Layout>
  );
}
