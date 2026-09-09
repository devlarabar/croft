import { Layout } from "../layout";
import type { ActiveModel, ProviderAdapter, schema } from "@croft/core";
import { fmtDate } from "../format-date";
import { Fieldset } from "./fieldset";
import { Button } from "./button";
import { PageHeader } from "./page-header";
import { Notice } from "./notice";

interface ModelsPageProps {
  providers: ProviderAdapter[];
  creds: (typeof schema.credentials.$inferSelect)[];
  active: ActiveModel | null;
  notice?: string;
}

export function ModelsPage(props: ModelsPageProps) {
  return (
    <Layout title="Models">
      <PageHeader title="Models" description="The model Croft runs on, and the credentials it may use." />
      <Notice>{props.notice}</Notice>
      <Fieldset legend="Active model">
        <form method="post" action="/models/active">
          <select aria-label="Active model" name="model" defaultValue={props.active ? `${props.active.providerId}/${props.active.model}` : undefined}>
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
          <select aria-label="Model credential" name="credentialId" defaultValue={props.active?.credentialId}>
            {props.creds.map((cred) => (
              <option key={cred.id} value={cred.id}>
                {cred.providerId} {cred.kind} ({cred.id.slice(0, 8)}) — {fmtDate(cred.createdAt)}
              </option>
            ))}
          </select>{" "}
          <Button className="secondary">Set active</Button>
        </form>
      </Fieldset>
      {props.providers.map((provider) => {
        let state = "Not configured";
        if (props.creds.some((cred) => cred.providerId === provider.id)) state = "Credentials saved";
        if (props.active?.providerId === provider.id) state = "Active";
        return (
        <Fieldset key={provider.id} legend={provider.id} annotation={state}>
          <p>{provider.models.join(", ")}</p>
          <form method="post" action="/models/credential">
            <input type="hidden" name="providerId" defaultValue={provider.id} />
            <input
              aria-label={provider.id === "bedrock" ? "Access key ID" : "API key"}
              name="apiKey"
              type="password"
              placeholder={provider.id === "bedrock" ? "Access key ID" : "API key"}
              size={40}
            />{" "}
            {provider.id === "azure" ? (
              <input
                aria-label="Azure resource name"
                name="resourceName"
                placeholder="Resource name (the myname in myname.openai.azure.com)"
                size={46}
              />
            ) : null}
            {provider.id === "bedrock" ? (
              <>
                <input aria-label="Secret access key" name="secretAccessKey" type="password" placeholder="Secret access key" size={40} />{" "}
                <input aria-label="Region" name="region" placeholder="Region" defaultValue="us-east-1" size={12} />
              </>
            ) : null}{" "}
            <Button className="secondary">Save credentials</Button>
          </form>
          {provider.oauth ? (
            <p>
              <a href={`/oauth/start?provider=${provider.id}`}>Connect with OAuth</a>
            </p>
          ) : null}
        </Fieldset>
        );
      })}
    </Layout>
  );
}
