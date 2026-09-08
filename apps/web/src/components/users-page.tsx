import type { schema } from "@croft/core";
import { Layout } from "../layout";
import { DataTable } from "./data-table";
import { Button } from "./button";

interface UsersPageProps {
  users: (typeof schema.dashboardUsers.$inferSelect)[];
  saved?: string;
  error?: string;
}

export function UsersPage({ users, saved, error }: UsersPageProps) {
  return (
    <Layout title="Users">
      <h1>Users</h1>
      <p>User: no access. Member: view runs and videos. Admin: full access, including managing roles.</p>
      {saved ? <p>Access updated.</p> : null}
      {error ? <p>Could not update access. Check the GitHub username and try again. devlarabar must remain an admin.</p> : null}
      <DataTable>
          <tr><th>GitHub username</th><th>Role</th></tr>
          {users.map((user) => <tr key={user.githubId}><td>{user.username}</td><td>{user.role}</td></tr>)}
      </DataTable>
      <h2>Set access</h2>
      <p>You can add someone before their first sign-in, or change an existing user’s role.</p>
      <form method="post" action="/users">
        <label>GitHub username <input name="username" required maxLength={39} /></label>{" "}
        <label>Role <select name="role">
          <option value="user">User</option>
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select></label>{" "}
        <Button>Save access</Button>
      </form>
    </Layout>
  );
}
