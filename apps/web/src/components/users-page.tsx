import type { schema } from "@croft/core";
import { Layout } from "../layout";
import { DataTable } from "./data-table";
import { Button } from "./button";
import { Fieldset } from "./fieldset";
import { PageHeader } from "./page-header";
import { Notice } from "./notice";

interface UsersPageProps {
  users: (typeof schema.dashboardUsers.$inferSelect)[];
  saved?: string;
  error?: string;
}

export function UsersPage({ users, saved, error }: UsersPageProps) {
  return (
    <Layout title="Users">
      <PageHeader title="Users" description="User: no access. Member: view runs and videos. Admin: full access, including managing roles." />
      {saved ? <Notice>Access updated.</Notice> : null}
      {error ? <p role="alert">Could not update access. Check the GitHub username and try again. devlarabar must remain an admin.</p> : null}
      <DataTable>
        <thead><tr><th>GitHub username</th><th className="w-45">Role</th></tr></thead>
        <tbody>{users.map((user) => <tr key={user.githubId}><td>{user.username}</td><td><span className={`status role-${user.role}`}>{user.role}</span></td></tr>)}</tbody>
      </DataTable>
      <Fieldset legend="Set access" description="You can add someone before their first sign-in, or change an existing user’s role.">
        <form method="post" action="/users">
          <label>GitHub username<input name="username" placeholder="username" required maxLength={39} /></label>
          <label>Role<select name="role">
            <option value="user">User</option><option value="member">Member</option><option value="admin">Admin</option>
          </select></label>
          <Button>Save access</Button>
        </form>
      </Fieldset>
    </Layout>
  );
}
