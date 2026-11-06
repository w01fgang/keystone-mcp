# F001 notes

## Seams

- `src/catalog.ts` reads `context.graphql.schema`. Keystone calls `extendExpressApp` again after each dev rebuild, so `src/mount.ts` builds the catalog inside the returned function.
- `src/server.ts` creates one `McpServer` per request. `src/mount.ts` connects it to a stateless `StreamableHTTPServerTransport` with `enableJsonResponse: true`, so `POST /mcp` answers `application/json`, not SSE.
- `callTool` runs `commonContext.withRequest(req, res)` and then `context.graphql.run`. The live proof below shows Keystone access control: `createPost` fails without a session and passes with `Authorization: Bearer <sessionToken>`.
- A missing `take` becomes `takeLimit`, as well as a `take` above it. Keystone list queries otherwise have no limit.

## Decisions

- Dual build. Keystone compiles `keystone.ts` to CommonJS and `require`s the package. An ESM-only `exports` map failed with `ERR_PACKAGE_PATH_NOT_EXPORTED` at `keystone dev`. `npm run build` now emits ESM to `dist/` (with `.d.ts`) and CommonJS to `dist/cjs/` (emit only, `noCheck`; the ESM pass type-checks the same sources).
- Install as a copy. A `file:` symlink makes the package resolve `graphql` from this checkout, which is a second `graphql` instance beside the app's. The smoke app uses `install-links=true` in `.npmrc`. After a rebuild, run `rm -rf node_modules/keystone-mcp && npm install` in the app; a plain `npm install` keeps the old copy.
- Keystone 8.3 (current `@keystone-6/core`) uses Express 5 and Prisma 7. The peer range is `express ^4.18 || ^5`. The package tests run on Express 4.

## Live proof

Scratch app: `/tmp/keystone-mcp-smoke` (outside Git). `@keystone-6/core` 8.3.0, `@keystone-6/auth` 10.0.6, SQLite through `@prisma/adapter-better-sqlite3`, `keystone-mcp` as `file:` dependency on the F001 worktree, installed as a copy. Seed: one user and 60 posts. Started with `KEYSTONE_TELEMETRY_DISABLED=1 npx keystone dev --no-ui`. Requests sent by `node proof.mjs` in that folder on 2026-11-06. The responses are complete; only the session token is redacted.

`keystone.ts`:

```ts
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { config, list } from '@keystone-6/core';
import { allowAll } from '@keystone-6/core/access';
import { password, relationship, select, text } from '@keystone-6/core/fields';
import { statelessSessions } from '@keystone-6/core/session';
import { createAuth } from '@keystone-6/auth';
import { keystoneMcp } from 'keystone-mcp';

const url = process.env.DATABASE_URL ?? 'file:./smoke.db';
const signedIn = ({ session }: { session?: unknown }) => Boolean(session);

const { withAuth } = createAuth({ listKey: 'User', identityField: 'email', secretField: 'password' });

export default withAuth(
  config({
    db: {
      provider: 'sqlite',
      prismaClientOptions: () => ({ adapter: new PrismaBetterSqlite3({ url }) }),
      // Seed data for the smoke test only. The package itself never uses sudo.
      async onConnect(context) {
        const sudo = context.sudo();
        if ((await sudo.db.User.count()) !== 0) return;
        const ada = await sudo.db.User.createOne({ data: { name: 'Ada', email: 'ada@example.com', password: 'smoke-password-1' } });
        for (let i = 1; i <= 60; i++) {
          await sudo.db.Post.createOne({
            data: { title: `Post ${i}`, status: i % 2 ? 'published' : 'draft', author: { connect: { id: ada.id } } },
          });
        }
      },
    },
    lists: {
      User: list({
        access: allowAll,
        fields: {
          name: text({ validation: { isRequired: true } }),
          email: text({ isIndexed: 'unique', validation: { isRequired: true } }),
          password: password(),
          posts: relationship({ ref: 'Post.author', many: true }),
        },
      }),
      Post: list({
        access: { operation: { query: () => true, create: signedIn, update: signedIn, delete: signedIn } },
        fields: {
          title: text({ validation: { isRequired: true } }),
          status: select({ type: 'enum', options: ['draft', 'published'], defaultValue: 'draft' }),
          author: relationship({ ref: 'User.posts' }),
        },
      }),
    },
    session: statelessSessions({ secret: 'keystone-mcp-smoke-secret-at-least-32-chars', maxAge: 3600 }),
    server: { port: 3911, extendExpressApp: keystoneMcp() },
  }),
);
```

Live `searchTool` result for `posts`, summarized from the full text:

```text
posts query [Post!] args: where: PostWhereInput! = {}, orderBy: [PostOrderByInput!]! = [], take: Int, skip: Int! = 0, cursor: PostWhereUniqueInput | paths: id title status author.id author.name author.email author.postsCount
createPosts mutation [Post] args: data: [PostCreateInput!]! | paths: id title status author.id author.name author.email author.postsCount
updatePosts mutation [Post] args: data: [PostUpdateArgs!]! | paths: id title status author.id author.name author.email author.postsCount
where fields: id title status author
```

### initialize

```http
POST /mcp
content-type: application/json
accept: application/json, text/event-stream

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-06-18",
    "capabilities": {},
    "clientInfo": {
      "name": "curl-proof",
      "version": "1.0.0"
    }
  }
}
```

```http
HTTP 200 application/json

{
  "result": {
    "protocolVersion": "2025-06-18",
    "capabilities": {
      "tools": {
        "listChanged": true
      }
    },
    "serverInfo": {
      "name": "keystone-mcp",
      "version": "0.1.0"
    }
  },
  "jsonrpc": "2.0",
  "id": 1
}
```

### tools/list

```http
POST /mcp
content-type: application/json
accept: application/json, text/event-stream

{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": {}
}
```

```http
HTTP 200 application/json

{
  "result": {
    "tools": [
      {
        "name": "searchTool",
        "description": "Find the GraphQL queries and mutations of this Keystone app. Each result has the operation name, its kind, its return type, its argument signatures, and the field paths that callTool can select.",
        "inputSchema": {
          "type": "object",
          "properties": {
            "text": {
              "type": "string",
              "description": "Words to match, for example \"posts\" or \"create user\"."
            },
            "limit": {
              "type": "integer",
              "minimum": 1,
              "maximum": 25,
              "description": "The number of results. Default: 10. Maximum: 25."
            }
          },
          "required": [
            "text"
          ],
          "additionalProperties": false,
          "$schema": "http://json-schema.org/draft-07/schema#"
        },
        "annotations": {
          "readOnlyHint": true
        },
        "execution": {
          "taskSupport": "forbidden"
        }
      },
      {
        "name": "callTool",
        "description": "Run one GraphQL operation that searchTool found, as the session of this request. Arguments become GraphQL variables. A take argument is at most 50. select lists field paths from searchTool; without select, the call returns the top-level paths.",
        "inputSchema": {
          "type": "object",
          "properties": {
            "operation": {
              "type": "string",
              "description": "The operation name from searchTool, for example \"posts\"."
            },
            "args": {
              "type": "object",
              "additionalProperties": {},
              "description": "Argument values by argument name."
            },
            "select": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "description": "Field paths from searchTool, for example [\"id\", \"author.name\"]."
            }
          },
          "required": [
            "operation"
          ],
          "additionalProperties": false,
          "$schema": "http://json-schema.org/draft-07/schema#"
        },
        "execution": {
          "taskSupport": "forbidden"
        }
      }
    ]
  },
  "jsonrpc": "2.0",
  "id": 2
}
```

### searchTool with text "posts"

```http
POST /mcp
content-type: application/json
accept: application/json, text/event-stream

{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "searchTool",
    "arguments": {
      "text": "posts",
      "limit": 3
    }
  }
}
```

```http
HTTP 200 application/json

{
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"operations\":[{\"name\":\"posts\",\"kind\":\"query\",\"returnType\":\"[Post!]\",\"args\":[{\"name\":\"where\",\"type\":\"PostWhereInput!\",\"defaultValue\":\"{}\",\"fields\":[{\"name\":\"id\",\"type\":\"IDFilter\",\"fields\":[{\"name\":\"equals\",\"type\":\"ID\"},{\"name\":\"in\",\"type\":\"[ID!]\"},{\"name\":\"notIn\",\"type\":\"[ID!]\"},{\"name\":\"lt\",\"type\":\"ID\"},{\"name\":\"lte\",\"type\":\"ID\"},{\"name\":\"gt\",\"type\":\"ID\"},{\"name\":\"gte\",\"type\":\"ID\"},{\"name\":\"not\",\"type\":\"IDFilter\"}]},{\"name\":\"title\",\"type\":\"StringFilter\",\"fields\":[{\"name\":\"equals\",\"type\":\"String\"},{\"name\":\"in\",\"type\":\"[String!]\"},{\"name\":\"notIn\",\"type\":\"[String!]\"},{\"name\":\"lt\",\"type\":\"String\"},{\"name\":\"lte\",\"type\":\"String\"},{\"name\":\"gt\",\"type\":\"String\"},{\"name\":\"gte\",\"type\":\"String\"},{\"name\":\"contains\",\"type\":\"String\"},{\"name\":\"startsWith\",\"type\":\"String\"},{\"name\":\"endsWith\",\"type\":\"String\"},{\"name\":\"not\",\"type\":\"NestedStringFilter\"}]},{\"name\":\"status\",\"type\":\"PostStatusTypeNullableFilter\",\"fields\":[{\"name\":\"equals\",\"type\":\"PostStatusType\"},{\"name\":\"in\",\"type\":\"[PostStatusType!]\"},{\"name\":\"notIn\",\"type\":\"[PostStatusType!]\"},{\"name\":\"not\",\"type\":\"PostStatusTypeNullableFilter\"}]},{\"name\":\"author\",\"type\":\"UserWhereInput\",\"fields\":[{\"name\":\"id\",\"type\":\"IDFilter\"},{\"name\":\"name\",\"type\":\"StringFilter\"},{\"name\":\"email\",\"type\":\"StringFilter\"},{\"name\":\"password\",\"type\":\"PasswordFilter\"}]}]},{\"name\":\"orderBy\",\"type\":\"[PostOrderByInput!]!\",\"defaultValue\":\"[]\",\"fields\":[{\"name\":\"id\",\"type\":\"OrderDirection\"},{\"name\":\"title\",\"type\":\"OrderDirection\"},{\"name\":\"status\",\"type\":\"OrderDirection\"}]},{\"name\":\"take\",\"type\":\"Int\"},{\"name\":\"skip\",\"type\":\"Int!\",\"defaultValue\":\"0\"},{\"name\":\"cursor\",\"type\":\"PostWhereUniqueInput\",\"fields\":[{\"name\":\"id\",\"type\":\"ID\"}]}],\"paths\":[\"id\",\"title\",\"status\",\"author.id\",\"author.name\",\"author.email\",\"author.postsCount\"],\"leaf\":false},{\"name\":\"createPosts\",\"kind\":\"mutation\",\"returnType\":\"[Post]\",\"args\":[{\"name\":\"data\",\"type\":\"[PostCreateInput!]!\",\"fields\":[{\"name\":\"title\",\"type\":\"String\"},{\"name\":\"status\",\"type\":\"PostStatusType\"},{\"name\":\"author\",\"type\":\"UserRelateToOneForCreateInput\",\"fields\":[{\"name\":\"create\",\"type\":\"UserCreateInput\"},{\"name\":\"connect\",\"type\":\"UserWhereUniqueInput\"}]}]}],\"paths\":[\"id\",\"title\",\"status\",\"author.id\",\"author.name\",\"author.email\",\"author.postsCount\"],\"leaf\":false},{\"name\":\"updatePosts\",\"kind\":\"mutation\",\"returnType\":\"[Post]\",\"args\":[{\"name\":\"data\",\"type\":\"[PostUpdateArgs!]!\",\"fields\":[{\"name\":\"where\",\"type\":\"PostWhereUniqueInput!\",\"fields\":[{\"name\":\"id\",\"type\":\"ID\"}]},{\"name\":\"data\",\"type\":\"PostUpdateInput!\",\"fields\":[{\"name\":\"title\",\"type\":\"String\"},{\"name\":\"status\",\"type\":\"PostStatusType\"},{\"name\":\"author\",\"type\":\"UserRelateToOneForUpdateInput\"}]}]}],\"paths\":[\"id\",\"title\",\"status\",\"author.id\",\"author.name\",\"author.email\",\"author.postsCount\"],\"leaf\":false}]}"
      }
    ]
  },
  "jsonrpc": "2.0",
  "id": 3
}
```

### callTool posts with take 80

```http
POST /mcp
content-type: application/json
accept: application/json, text/event-stream

{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "callTool",
    "arguments": {
      "operation": "posts",
      "args": {
        "take": 80,
        "orderBy": [
          {
            "title": "asc"
          }
        ]
      },
      "select": [
        "id",
        "title",
        "author.name"
      ]
    }
  }
}
```

```http
HTTP 200 application/json

{
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"posts\":[{\"id\":\"cmw4z6ydu000197lpo3x8khbo\",\"title\":\"Post 1\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6ye0000a97lp6y4jt8iz\",\"title\":\"Post 10\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6ye0000b97lpawhk7uj6\",\"title\":\"Post 11\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6ye1000c97lpp41vumpz\",\"title\":\"Post 12\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6ye1000d97lpa0908qy3\",\"title\":\"Post 13\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6ye1000e97lp8o76iras\",\"title\":\"Post 14\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6ye2000f97lpoccoybe3\",\"title\":\"Post 15\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6ye2000g97lpo7xxgvae\",\"title\":\"Post 16\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6ye3000h97lp7a5dhcfw\",\"title\":\"Post 17\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6ye3000i97lpiienbvuk\",\"title\":\"Post 18\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6ye4000j97lpod8c1wna\",\"title\":\"Post 19\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6ydv000297lpyptorv19\",\"title\":\"Post 2\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6ye4000k97lpp0lxnb25\",\"title\":\"Post 20\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6ye5000l97lptug4259m\",\"title\":\"Post 21\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6ye5000m97lp694ydajm\",\"title\":\"Post 22\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6ye5000n97lpsbqf7o5v\",\"title\":\"Post 23\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6ye6000o97lpkk38opxv\",\"title\":\"Post 24\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6ye7000p97lpdhmeo5jg\",\"title\":\"Post 25\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6ye7000q97lpdn65b27v\",\"title\":\"Post 26\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6ye8000r97lp5xxiqfbx\",\"title\":\"Post 27\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6ye8000s97lpuctnz73v\",\"title\":\"Post 28\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6ye9000t97lp28l73e5t\",\"title\":\"Post 29\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6ydw000397lp8r7esx0c\",\"title\":\"Post 3\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6ye9000u97lpgpfysszz\",\"title\":\"Post 30\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6yea000v97lpb7ybhj1t\",\"title\":\"Post 31\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6yea000w97lp58t7u3u2\",\"title\":\"Post 32\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6yea000x97lpukfpx6dq\",\"title\":\"Post 33\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6yeb000y97lp0g4wyqhh\",\"title\":\"Post 34\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6yeb000z97lpj6a1hl17\",\"title\":\"Post 35\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6yec001097lpcv345geg\",\"title\":\"Post 36\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6yec001197lppek841n8\",\"title\":\"Post 37\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6yed001297lppd8tmorp\",\"title\":\"Post 38\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6yed001397lpdq3v3am2\",\"title\":\"Post 39\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6ydw000497lpgbubapv4\",\"title\":\"Post 4\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6yee001497lpz0p22p47\",\"title\":\"Post 40\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6yee001597lp2p0jd8sr\",\"title\":\"Post 41\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6yef001697lp8us0dtil\",\"title\":\"Post 42\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6yef001797lp45pbf2jf\",\"title\":\"Post 43\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6yeg001897lp6fo1msar\",\"title\":\"Post 44\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6yeg001997lp9e7u4v06\",\"title\":\"Post 45\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6yeh001a97lpyqi8ihqf\",\"title\":\"Post 46\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6yeh001b97lpnxj3m76m\",\"title\":\"Post 47\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6yei001c97lpqk3w79j8\",\"title\":\"Post 48\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6yej001d97lpym5p8obw\",\"title\":\"Post 49\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6ydx000597lpamlw9ubu\",\"title\":\"Post 5\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6yej001e97lpu4zwaf4e\",\"title\":\"Post 50\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6yek001f97lpmbfhkc0v\",\"title\":\"Post 51\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6yek001g97lpj0x1f5px\",\"title\":\"Post 52\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6yel001h97lpjtunfr3v\",\"title\":\"Post 53\",\"author\":{\"name\":\"Ada\"}},{\"id\":\"cmw4z6yel001i97lp8dz722iu\",\"title\":\"Post 54\",\"author\":{\"name\":\"Ada\"}}]}"
      }
    ]
  },
  "jsonrpc": "2.0",
  "id": 4
}
```

Rows returned by callTool posts with take 80: **50** (60 posts exist).

### callTool with an unknown operation

```http
POST /mcp
content-type: application/json
accept: application/json, text/event-stream

{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "tools/call",
  "params": {
    "name": "callTool",
    "arguments": {
      "operation": "invoices"
    }
  }
}
```

```http
HTTP 200 application/json

{
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Unknown operation \"invoices\". Use searchTool to find the name of an operation."
      }
    ],
    "isError": true
  },
  "jsonrpc": "2.0",
  "id": 5
}
```

### callTool createPost without a session

```http
POST /mcp
content-type: application/json
accept: application/json, text/event-stream

{
  "jsonrpc": "2.0",
  "id": 6,
  "method": "tools/call",
  "params": {
    "name": "callTool",
    "arguments": {
      "operation": "createPost",
      "args": {
        "data": {
          "title": "From MCP"
        }
      },
      "select": [
        "id",
        "title"
      ]
    }
  }
}
```

```http
HTTP 200 application/json

{
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Access denied: You cannot create that Post"
      }
    ],
    "isError": true
  },
  "jsonrpc": "2.0",
  "id": 6
}
```

### Sign in through the GraphQL API to get a session token

```http
POST /api/graphql
content-type: application/json

{
  "query": "mutation { authenticateUserWithPassword(email: \"ada@example.com\", password: \"smoke-password-1\") { ... on UserAuthenticationWithPasswordSuccess { sessionToken item { id } } } }"
}
```

```http
HTTP 200 application/json; charset=utf-8

{
  "data": {
    "authenticateUserWithPassword": {
      "sessionToken": "<redacted Fe26.2 token>",
      "item": {
        "id": "cmw4z6ydk000097lpul5uq1tx"
      }
    }
  }
}
```

### callTool createPost with Authorization: Bearer

```http
POST /mcp
content-type: application/json
accept: application/json, text/event-stream
authorization: Bearer <sessionToken>

{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "tools/call",
  "params": {
    "name": "callTool",
    "arguments": {
      "operation": "createPost",
      "args": {
        "data": {
          "title": "From MCP"
        }
      },
      "select": [
        "id",
        "title"
      ]
    }
  }
}
```

```http
HTTP 200 application/json

{
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"createPost\":{\"id\":\"cmw4z7dsv001p97lpda5ornte\",\"title\":\"From MCP\"}}"
      }
    ]
  },
  "jsonrpc": "2.0",
  "id": 7
}
```

### GET /mcp

```http
GET /mcp

```

```http
HTTP 405 application/json; charset=utf-8

{
  "jsonrpc": "2.0",
  "error": {
    "code": -32000,
    "message": "Method not allowed."
  },
  "id": null
}
```

### DELETE /mcp

```http
DELETE /mcp

```

```http
HTTP 405 application/json; charset=utf-8

{
  "jsonrpc": "2.0",
  "error": {
    "code": -32000,
    "message": "Method not allowed."
  },
  "id": null
}
```
