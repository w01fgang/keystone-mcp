import type { Express, NextFunction, Request, Response } from 'express';
import type { KeystoneContext } from '@keystone-6/core/types';
import type { Session } from './schema';

type Product = {
  name: string;
  slug: string;
  description: string;
  priceCents: number;
  stock: number;
  status: string;
  category: { name: string } | null;
};

const productFields = 'name slug description priceCents stock status category { name }';
const price = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR' });

/**
 * Mounts the storefront: `/` lists products, `/products/:slug` shows one.
 * Each page reads as the session of its request, so the access rules in schema.ts decide what it shows.
 */
export function storefront(app: Express, commonContext: KeystoneContext): void {
  app.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const context = await commonContext.withRequest(req, res);
      const products = (await context.query.Product.findMany({ orderBy: { name: 'asc' }, query: productFields })) as Product[];
      const items = products.map(
        (product) => `<li>
  <a href="/products/${encodeURIComponent(product.slug)}">${escape(product.name)}</a>${draftBadge(product)}
  <span class="meta">${meta(product)}</span>
</li>`,
      );
      res.type('html').send(page('Shop', context.session, `<h1>Products</h1>\n<ul>\n${items.join('\n')}\n</ul>`));
    } catch (error) {
      next(error);
    }
  });

  app.get('/products/:slug', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const context = await commonContext.withRequest(req, res);
      const product = (await context.query.Product.findOne({ where: { slug: req.params.slug }, query: productFields })) as Product | null;
      if (!product) {
        res.status(404).type('html').send(page('Not found', context.session, '<h1>Not found</h1>\n<p><a href="/">All products</a></p>'));
        return;
      }
      res.type('html').send(
        page(
          product.name,
          context.session,
          `<p><a href="/">All products</a></p>
<h1>${escape(product.name)}${draftBadge(product)}</h1>
<p class="meta">${meta(product)}</p>
<p>${escape(product.description)}</p>`,
        ),
      );
    } catch (error) {
      next(error);
    }
  });
}

function meta(product: Product): string {
  const stock = product.stock > 0 ? `${product.stock} in stock` : 'sold out';
  return `${escape(product.category?.name ?? 'No category')} · ${price.format(product.priceCents / 100)} · ${stock}`;
}

// Only an admin can read a draft, so only an admin sees this badge.
function draftBadge(product: Product): string {
  return product.status === 'draft' ? ' <span class="draft">draft</span>' : '';
}

function page(title: string, session: Session | undefined, body: string): string {
  const user = session ? `Signed in as ${escape(session.data.name)}` : 'Not signed in';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; }
  header { display: flex; justify-content: space-between; color: #555; }
  ul { list-style: none; padding: 0; }
  li { margin: 0 0 0.75rem; }
  .meta { display: block; color: #555; }
  .draft { font-size: 0.8em; background: #fde68a; padding: 0 0.3em; border-radius: 3px; }
</style>
</head>
<body>
<header><a href="/">Shop</a><span>${user} · <a href="/admin">Admin UI</a></span></header>
${body}
</body>
</html>`;
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
