import { defineConfig } from 'prisma/config';

// Keystone runs `prisma db push` with this file. keystone.ts opens the same database file.
export default defineConfig({
  schema: 'schema.prisma',
  migrations: {
    path: 'migrations',
  },
  datasource: {
    url: 'file:./keystone.db',
  },
});
