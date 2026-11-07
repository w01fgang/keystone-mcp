import { list } from '@keystone-6/core';
import { allowAll } from '@keystone-6/core/access';
import { checkbox, integer, password, relationship, select, text, timestamp } from '@keystone-6/core/fields';

// The session that `createAuth` in keystone.ts builds: `sessionData` is 'name isAdmin'.
export type Session = { listKey: 'User'; itemId: string; data: { name: string; isAdmin: boolean } };

type Access = { session?: Session };

const isSignedIn = ({ session }: Access) => Boolean(session);
const isAdmin = ({ session }: Access) => Boolean(session?.data.isAdmin);

// Everyone may query; a filter below decides which items each session sees. Only an admin writes.
const publicReadAdminWrite = { query: allowAll, create: isAdmin, update: isAdmin, delete: isAdmin };
const signedInReadAdminWrite = { query: isSignedIn, create: isAdmin, update: isAdmin, delete: isAdmin };

export const lists = {
  User: list({
    access: {
      operation: signedInReadAdminWrite,
      // A customer sees only their own user item.
      filter: { query: ({ session }: Access) => (session?.data.isAdmin ? true : { id: { equals: session?.itemId } }) },
    },
    ui: { listView: { initialColumns: ['name', 'email', 'isAdmin'] } },
    fields: {
      name: text({ validation: { isRequired: true } }),
      email: text({ isIndexed: 'unique', validation: { isRequired: true } }),
      password: password({ validation: { isRequired: true } }),
      isAdmin: checkbox(),
      orders: relationship({ ref: 'Order.customer', many: true }),
    },
  }),

  Category: list({
    access: { operation: publicReadAdminWrite },
    fields: {
      name: text({ validation: { isRequired: true } }),
      slug: text({ isIndexed: 'unique', validation: { isRequired: true } }),
      products: relationship({ ref: 'Product.category', many: true }),
    },
  }),

  Product: list({
    access: {
      operation: publicReadAdminWrite,
      // Anyone sees published products. Only an admin sees drafts.
      filter: { query: ({ session }: Access) => (session?.data.isAdmin ? true : { status: { equals: 'published' } }) },
    },
    ui: { listView: { initialColumns: ['name', 'status', 'priceCents', 'stock', 'category'] } },
    fields: {
      name: text({ validation: { isRequired: true } }),
      slug: text({ isIndexed: 'unique', validation: { isRequired: true } }),
      description: text({ ui: { displayMode: 'textarea' } }),
      priceCents: integer({ validation: { isRequired: true, min: 0 } }),
      stock: integer({ defaultValue: 0, validation: { isRequired: true, min: 0 } }),
      status: select({
        type: 'string',
        options: [
          { label: 'Draft', value: 'draft' },
          { label: 'Published', value: 'published' },
        ],
        defaultValue: 'draft',
        validation: { isRequired: true },
        ui: { displayMode: 'segmented-control' },
      }),
      category: relationship({ ref: 'Category.products' }),
    },
  }),

  Order: list({
    access: {
      operation: signedInReadAdminWrite,
      // A customer sees only their own orders.
      filter: {
        query: ({ session }: Access) => (session?.data.isAdmin ? true : { customer: { id: { equals: session?.itemId } } }),
      },
    },
    ui: { listView: { initialColumns: ['customer', 'status', 'createdAt'], initialSort: { field: 'createdAt', direction: 'DESC' } } },
    fields: {
      customer: relationship({ ref: 'User.orders' }),
      status: select({
        type: 'string',
        options: [
          { label: 'Paid', value: 'paid' },
          { label: 'Shipped', value: 'shipped' },
          { label: 'Delivered', value: 'delivered' },
          { label: 'Cancelled', value: 'cancelled' },
        ],
        defaultValue: 'paid',
        validation: { isRequired: true },
      }),
      lines: relationship({ ref: 'OrderLine.order', many: true }),
      createdAt: timestamp({ defaultValue: { kind: 'now' }, validation: { isRequired: true } }),
    },
  }),

  OrderLine: list({
    access: {
      operation: signedInReadAdminWrite,
      // A customer sees only the lines of their own orders.
      filter: {
        query: ({ session }: Access) =>
          session?.data.isAdmin ? true : { order: { customer: { id: { equals: session?.itemId } } } },
      },
    },
    fields: {
      order: relationship({ ref: 'Order.lines' }),
      product: relationship({ ref: 'Product' }),
      quantity: integer({ defaultValue: 1, validation: { isRequired: true, min: 1 } }),
      // The price when the order was placed. A later price change does not alter the order.
      priceCents: integer({ validation: { isRequired: true, min: 0 } }),
    },
  }),
};
