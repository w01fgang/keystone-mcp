import type { KeystoneContext } from '@keystone-6/core/types';

// Example accounts for local use only. Change or delete them before the app is reachable by anyone else.
export const seedUsers = [
  { name: 'Ada Admin', email: 'admin@example.com', password: 'shop-admin-1234', isAdmin: true },
  { name: 'Carl Customer', email: 'carl@example.com', password: 'shop-carl-1234', isAdmin: false },
  { name: 'Dana Customer', email: 'dana@example.com', password: 'shop-dana-1234', isAdmin: false },
];

const categories = [
  { name: 'Coffee', slug: 'coffee' },
  { name: 'Tea', slug: 'tea' },
  { name: 'Equipment', slug: 'equipment' },
];

const products = [
  { slug: 'house-espresso', name: 'House Espresso', category: 'coffee', priceCents: 1290, stock: 42, status: 'published', description: 'Dark roast, 500 g beans. Chocolate and hazelnut.' },
  { slug: 'ethiopia-yirgacheffe', name: 'Ethiopia Yirgacheffe', category: 'coffee', priceCents: 1590, stock: 4, status: 'published', description: 'Light roast, 250 g beans. Jasmine and lemon.' },
  { slug: 'decaf-colombia', name: 'Decaf Colombia', category: 'coffee', priceCents: 1190, stock: 0, status: 'published', description: 'Medium roast, 250 g beans, decaffeinated with water.' },
  { slug: 'winter-blend', name: 'Winter Blend', category: 'coffee', priceCents: 1490, stock: 60, status: 'draft', description: 'Seasonal blend. Not for sale yet.' },
  { slug: 'sencha', name: 'Sencha', category: 'tea', priceCents: 990, stock: 25, status: 'published', description: 'Japanese green tea, 100 g.' },
  { slug: 'earl-grey', name: 'Earl Grey', category: 'tea', priceCents: 790, stock: 3, status: 'published', description: 'Black tea with bergamot, 100 g.' },
  { slug: 'hand-grinder', name: 'Hand Grinder', category: 'equipment', priceCents: 6900, stock: 8, status: 'published', description: 'Steel burrs, 40 g hopper.' },
  { slug: 'pour-over-kit', name: 'Pour-over Kit', category: 'equipment', priceCents: 3400, stock: 12, status: 'draft', description: 'Dripper, 100 filters and a glass server.' },
];

const orders = [
  { customer: 'carl@example.com', status: 'delivered', createdAt: '2026-10-02T09:15:00Z', lines: [['house-espresso', 2], ['hand-grinder', 1]] },
  { customer: 'dana@example.com', status: 'shipped', createdAt: '2026-10-20T16:40:00Z', lines: [['sencha', 3]] },
  { customer: 'carl@example.com', status: 'paid', createdAt: '2026-11-03T11:05:00Z', lines: [['ethiopia-yirgacheffe', 1], ['earl-grey', 2]] },
  { customer: 'dana@example.com', status: 'paid', createdAt: '2026-11-06T18:30:00Z', lines: [['house-espresso', 1]] },
] as const;

/** Fills an empty database with the shop's example data. It runs at start, outside any request. */
export async function seed(context: KeystoneContext): Promise<void> {
  const sudo = context.sudo();
  if ((await sudo.db.User.count()) > 0) return;

  await sudo.db.User.createMany({ data: seedUsers });
  await sudo.db.Category.createMany({ data: categories });
  await sudo.db.Product.createMany({
    data: products.map(({ category, ...product }) => ({ ...product, category: { connect: { slug: category } } })),
  });
  const priceOf = new Map(products.map((product) => [product.slug, product.priceCents]));
  await sudo.db.Order.createMany({
    data: orders.map((order) => ({
      customer: { connect: { email: order.customer } },
      status: order.status,
      createdAt: order.createdAt,
      lines: {
        create: order.lines.map(([slug, quantity]) => ({ product: { connect: { slug } }, quantity, priceCents: priceOf.get(slug) })),
      },
    })),
  });
  console.log(`Seeded the shop. Sign in as ${seedUsers.map((user) => user.email).join(', ')}; see README.md.`);
}
