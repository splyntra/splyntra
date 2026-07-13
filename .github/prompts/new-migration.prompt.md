---
description: "Add a new ClickHouse or Postgres migration. Use when schema changes are needed for new features, columns, or indices."
---

# New Migration

Add a database migration for: ${input:description}

Target database: ${input:database:clickhouse,postgres}

## Steps

1. Find the highest-numbered migration in `migrations/${input:database}/`
2. Create the next sequential file: `migrations/${input:database}/<next_number>_<short_name>.sql`
3. Write idempotent SQL (use `IF NOT EXISTS`, `IF NOT EXISTS` for columns where supported)
4. For ClickHouse: use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
5. For Postgres: standard DDL with transactions

## Constraints

- Migrations auto-apply via Docker `entrypoint-initdb.d` — they must be idempotent
- Never drop columns in production without a deprecation period
- ClickHouse doesn't support transactions — each statement must be independently safe
- Include a comment header with the migration purpose and date
