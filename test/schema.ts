import type { IncomingMessage } from 'node:http';
import { buildSchema, graphql } from 'graphql';
import type { McpContext } from '../src/types.js';

/**
 * A GraphQL schema in the shape that Keystone 6 generates for two lists, `Post` and `User`, with `@keystone-6/auth`
 * on `User`, plus the `keystone` meta field and one output field with a required argument.
 */
export const sdl = /* GraphQL */ `
  type Query {
    "Read many posts."
    posts(
      where: PostWhereInput! = {}
      orderBy: [PostOrderByInput!]! = []
      take: Int
      skip: Int! = 0
      cursor: PostWhereUniqueInput
    ): [Post!]
    post(where: PostWhereUniqueInput!): Post
    postsCount(where: PostWhereInput! = {}): Int
    users(where: UserWhereInput! = {}, take: Int, skip: Int! = 0): [User!]
    user(where: UserWhereUniqueInput!): User
    keystone: KeystoneMeta!
  }

  type Mutation {
    createPost(data: PostCreateInput!): Post
    updatePost(where: PostWhereUniqueInput!, data: PostUpdateInput!): Post
    deletePost(where: PostWhereUniqueInput!): Post
    authenticateUserWithPassword(email: String!, password: String!): UserAuthenticationWithPasswordResult
  }

  union UserAuthenticationWithPasswordResult = UserAuthenticationWithPasswordSuccess | UserAuthenticationWithPasswordFailure

  type UserAuthenticationWithPasswordSuccess {
    sessionToken: String!
    item: User!
  }

  type UserAuthenticationWithPasswordFailure {
    message: String!
  }

  type Post {
    id: ID!
    title: String
    status: PostStatusType
    excerpt(length: Int!): String
    author: User
    tags: [String!]
    content: PostContent
  }

  type PostContent {
    document(hydrateRelationships: Boolean! = false): String!
    wordCount: Int
  }

  type User {
    id: ID!
    name: String
    email: String
    posts(where: PostWhereInput! = {}, take: Int, skip: Int! = 0): [Post!]
    postsCount(where: PostWhereInput! = {}): Int
  }

  enum PostStatusType {
    draft
    published
  }

  enum OrderDirection {
    asc
    desc
  }

  input PostWhereUniqueInput {
    id: ID
  }

  input PostWhereInput {
    AND: [PostWhereInput!]
    OR: [PostWhereInput!]
    NOT: [PostWhereInput!]
    id: IDFilter
    title: StringFilter
    status: PostStatusTypeNullableFilter
    author: UserWhereInput
  }

  input PostOrderByInput {
    id: OrderDirection
    title: OrderDirection
  }

  input PostCreateInput {
    title: String
    status: PostStatusType
    author: UserRelateToOneForCreateInput
  }

  input PostUpdateInput {
    title: String
    status: PostStatusType
  }

  input UserWhereUniqueInput {
    id: ID
    email: String
  }

  input UserWhereInput {
    AND: [UserWhereInput!]
    OR: [UserWhereInput!]
    NOT: [UserWhereInput!]
    id: IDFilter
    name: StringFilter
    posts: PostManyRelationFilter
  }

  input PostManyRelationFilter {
    every: PostWhereInput
    some: PostWhereInput
    none: PostWhereInput
  }

  input UserRelateToOneForCreateInput {
    create: UserCreateInput
    connect: UserWhereUniqueInput
  }

  input UserCreateInput {
    name: String
    email: String
  }

  input IDFilter {
    equals: ID
    in: [ID!]
    not: IDFilter
  }

  input StringFilter {
    equals: String
    contains: String
    mode: QueryMode
    not: NestedStringFilter
  }

  input NestedStringFilter {
    equals: String
    contains: String
    not: NestedStringFilter
  }

  enum QueryMode {
    default
    insensitive
  }

  input PostStatusTypeNullableFilter {
    equals: PostStatusType
    in: [PostStatusType!]
    not: PostStatusTypeNullableFilter
  }

  type KeystoneMeta {
    adminMeta: String
  }
`;

export const schema = buildSchema(sdl);

/** Root values for the fixture. `posts` returns as many rows as `take` asks for. */
const rootValue = {
  posts: ({ take }: { take?: number }) =>
    Array.from({ length: take ?? 100 }, (_, i) => ({ id: String(i + 1), title: `Post ${i + 1}`, author: { name: 'Ada' } })),
  postsCount: () => 100,
  createPost: ({ data }: { data: { title?: string } }) => ({ id: '101', title: data.title }),
};

export interface RunRecord {
  query: string;
  variables?: Record<string, unknown>;
}

/** The fixture's one user and the password that signs it in. */
export const ADMIN = { email: 'admin@example.com', password: 'correct horse battery staple' };

/**
 * A Keystone-like context. `withRequest` returns a separate request context, and only the
 * request context executes documents, so a test can see which context ran a call.
 * The password mutation starts a session in `sessions`; `withRequest` reads it from `Authorization: Bearer`,
 * as Keystone's `statelessSessions` does. Deleting an entry ends that session.
 */
export function fakeContext() {
  const runs: RunRecord[] = [];
  const requests: IncomingMessage[] = [];
  const sessions = new Map<string, { listKey: string; itemId: string }>();

  const signInRoot = {
    ...rootValue,
    authenticateUserWithPassword: ({ email, password }: { email: string; password: string }) => {
      if (email !== ADMIN.email || password !== ADMIN.password) {
        return { __typename: 'UserAuthenticationWithPasswordFailure', message: 'Authentication failed.' };
      }

      const sessionToken = `keystone-session-${sessions.size + 1}`;
      sessions.set(sessionToken, { listKey: 'User', itemId: '1' });

      return { __typename: 'UserAuthenticationWithPasswordSuccess', sessionToken, item: { id: '1' } };
    },
  };

  const run = async ({ query, variables }: RunRecord) => {
    runs.push({ query, variables });
    const result = await graphql({ schema, source: query, variableValues: variables, rootValue: signInRoot });

    if (result.errors?.length) throw result.errors[0];

    return result.data;
  };

  const requestContext: McpContext = {
    graphql: { schema, run },
    withRequest: () => Promise.reject(new Error('withRequest on a request context')),
  };

  const commonContext: McpContext = {
    graphql: {
      schema,
      run: () => Promise.reject(new Error('commonContext.graphql.run must not run a call')),
    },
    withRequest: async (req) => {
      requests.push(req);
      const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];

      return { ...requestContext, session: token ? sessions.get(token) : undefined };
    },
  };

  return { commonContext, requestContext, runs, requests, sessions };
}
