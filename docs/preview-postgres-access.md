# Preview Postgres access

Croft's worker uses a dedicated SSH key to access a Journalia PR preview's Postgres database.

## Provision the SSH key

Generate a dedicated, revocable keypair on a trusted machine:

```bash
ssh-keygen -t ed25519 -f croft-preview-db -C croft
```

Register the public key on the Coolify host using Journalia's preview database setup script:

```bash
sudo ./setup-preview-db-agent.sh add-key croft "$(cat croft-preview-db.pub)"
```

Add the following secrets to Croft's Scaleway worker job definition:

```text
PREVIEW_DB_SSH_KEY=<contents of croft-preview-db>
PREVIEW_DB_SSH_HOST=preview-db-agent@<host>
PREVIEW_DB_SSH_KNOWN_HOSTS=<verified SSH host-key entry>
```

Scaleway environment-variable updates replace the whole environment map. Include every existing variable whenever updating it.

Never commit the private key. Delete the local copy after storing it in Scaleway.

## Worker behavior

Configured test runs expose a `query_preview_postgres` tool. Croft can use it to inspect or create test state in the current PR's database. The worker derives the `pr-<N>` identifier from the run, passes SQL over SSH stdin, pins the server through `PREVIEW_DB_SSH_KNOWN_HOSTS`, and deletes its temporary key files after each query.

The tool is omitted when none of the three environment variables are set. A partially configured worker fails the run instead of silently attempting an insecure connection.

Journalia's forced SSH command runs `psql` inside the selected preview's Postgres container. It does not provide ClickHouse access.

## Revoke access

On the Coolify host:

```bash
sudo ./setup-preview-db-agent.sh revoke-key croft
```
