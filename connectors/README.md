# Connector files (self-hosted)

Mounted read-only into the API container by `docker-compose.yml`.

| Folder | Purpose |
|---|---|
| `data/` | SQLite files you want to query from the Data Studio (`/data` in the container). |
| `secrets/` | `ga4-service-account.json`, the Google Cloud service-account key for GA4. **Never commit it**: it's git-ignored. |

See the main README → *Connect your data sources* for step-by-step setup.
