import { Layout } from "../layout";

export function UnavailablePage() {
  return (
    <Layout title="Content unavailable" role="user">
      <h1>This content isn’t available</h1>
      <p>Contact an administrator to request access.</p>
    </Layout>
  );
}
