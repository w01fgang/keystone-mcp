import { config } from '@keystone-6/core';
import { statelessSessions } from '@keystone-6/core/session';
import { createAuth } from '@keystone-6/auth';
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
const mcp = keystoneMcp();

export default withAuth(
  config({
    db: {
      provider: 'sqlite',
      url: 'file:./keystone.db',
      onConnect: seed,
    },
    lists,
    // Without SESSION_SECRET, Keystone makes a random secret at each start, and everyone signs in again.
    session: statelessSessions({ secret: process.env.SESSION_SECRET }),
    ui: {
      // The storefront owns `/`, so the Admin UI moves to `/admin`.
      basePath: '/admin',
      // Customers use the storefront and MCP. Only an admin opens the Admin UI.
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
