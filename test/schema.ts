import { buildSchema } from 'graphql';

/**
 * A GraphQL schema in the shape that Keystone 6 generates for two lists, `Post` and `User`,
 * plus the `keystone` meta field and one output field with a required argument.
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
