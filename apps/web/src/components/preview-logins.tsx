import type { PreviewLogin } from "@croft/core";

interface PreviewLoginsProps {
  repo: string;
  logins: PreviewLogin[];
}

export function PreviewLogins({ repo, logins }: PreviewLoginsProps) {
  return (
    <div className="repo-section">
      <strong>{repo}</strong>
      {[...logins, undefined].map((login, index) => (
        <div className="login-row" key={index}>
          <input aria-label={`${repo} account ${index + 1} label`} name={`login_label_${repo}_${index}`} placeholder="label (optional)" defaultValue={login?.label} />
          <input aria-label={`${repo} account ${index + 1} login URL`} name={`login_url_${repo}_${index}`} placeholder="login URL (optional)" defaultValue={login?.loginUrl} />
          <input aria-label={`${repo} account ${index + 1} username`} name={`login_user_${repo}_${index}`} placeholder="username" defaultValue={login?.username} />
          <input aria-label={`${repo} account ${index + 1} password`} name={`login_pass_${repo}_${index}`} type="password" placeholder={login ? "(unchanged)" : "password"} />
        </div>
      ))}
    </div>
  );
}
