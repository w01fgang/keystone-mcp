import { config } from '@keystone-6/core';
import { statelessSessions } from '@keystone-6/core/session';
import { createAuth } from '@keystone-6/auth';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { keystoneMcp } from 'keystone-mcp';
import { lists, type Session } from './schema';
import { seed } from './seed';
import { storefront } from './storefront';

// keystone-mcp signs users in with this password mutation (authenticateUserWithPassword).
const { withAuth } = createAuth({
  listKey: 'User',
  identityField: 'email',
  secretField: 'password',
  sessionData: 'name isAdmin',
});

// Create the MCP function once, outside extendExpressApp. Keystone calls extendExpressApp again after each dev rebuild.
// The agent reads `instructions` first when it connects, so it learns what this project is. With MCP_SECRET, sign-ins
// survive a restart and work on every process that has the same secret.
const mcp = keystoneMcp({
  instructions:
    'This is a small online shop. It sells products, sorted into categories. ' +
    'Its users are the customers and the admins of the shop. A customer places orders; ' +
    'each order has one order line for each product bought. Prices are in cents (priceCents). ' +
    'A customer reads the products and their own orders. An admin can read and change everything.',
  secret: process.env.MCP_SECRET,
});

export default withAuth(
  config({
    db: {
      provider: 'sqlite',
      // Prisma 7 opens SQLite through an adapter. prisma.config.ts names the same file for `prisma db push`.
      prismaClientOptions: () => ({ adapter: new PrismaBetterSqlite3({ url: 'file:./keystone.db' }) }),
      onConnect: seed,
    },
    lists,
    // Without SESSION_SECRET, Keystone makes a random secret at each start, and everyone signs in again.
    session: statelessSessions({ secret: process.env.SESSION_SECRET }),
    ui: {
      // The storefront owns `/`, so the Admin UI moves to `/admin`.
      basePath: '/admin',
      // Customers use the storefront and MCP. Only an admin opens the Admin UI.
      // SAFETY: createAuth above writes `sessionData: 'name isAdmin'` of a User into the session, which is the shape of `Session`.
      isAccessAllowed: ({ session }) => Boolean((session as Session | undefined)?.data.isAdmin),
    },
    server: {
      extendExpressApp: (app, context) => {
        // A tunnel such as cloudflared ends TLS. Trust its X-Forwarded-Proto, so that the OAuth URLs use https.
        app.set('trust proxy', 1);
        mcp(app, context);
        storefront(app, context);
      },
    },
  }),
);
