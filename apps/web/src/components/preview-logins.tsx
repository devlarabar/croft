import { Fragment } from "react";
import type { PreviewLogin } from "@croft/core";

interface PreviewLoginsProps {
  repo: string;
  logins: PreviewLogin[];
}

export function PreviewLogins({ repo, logins }: PreviewLoginsProps) {
  return (
    <p>
      <strong>{repo}</strong>
      {[...logins, undefined].map((login, index) => (
        <Fragment key={index}>
          <br />
          <input name={`login_label_${repo}_${index}`} placeholder="label (optional)" defaultValue={login?.label} />{" "}
          <input name={`login_url_${repo}_${index}`} placeholder="login URL (optional)" size={40} defaultValue={login?.loginUrl} />{" "}
          <input name={`login_user_${repo}_${index}`} placeholder="username" defaultValue={login?.username} />{" "}
          <input name={`login_pass_${repo}_${index}`} type="password" placeholder={login ? "(unchanged)" : "password"} />
        </Fragment>
      ))}
    </p>
  );
}
