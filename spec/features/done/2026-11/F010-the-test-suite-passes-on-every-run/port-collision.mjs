// Shows, without luck, why a test server on all interfaces loses requests to http://127.0.0.1:<port>.
// Run: node spec/features/active/F010-the-test-suite-passes-on-every-run/port-collision.mjs
// The test server takes a free port with `listen(0, host)`. Then another program binds 127.0.0.1 on that same port,
// as a program with a fixed or remembered port does. The script prints whether that bind succeeds and which server
// answers http://127.0.0.1:<port>.
import { once } from 'node:events';
import { createServer } from 'node:http';

for (const host of [undefined, '127.0.0.1']) {
  const test = createServer((_req, res) => res.end('test server')).listen(0, host);
  await once(test, 'listening');
  const { port } = test.address();
  const other = createServer((_req, res) => res.writeHead(404).end('not found')).listen(port, '127.0.0.1');
  const bound = await once(other, 'listening').then(() => 'succeeds', (error) => `fails with ${error.code}`);
  const answer = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  console.log(`test server on listen(0${host ? `, '${host}'` : ''}): the other program's bind of 127.0.0.1:${port} ${bound}; http://127.0.0.1:${port}/ answers "${answer}"`);
  other.close();
  test.close();
}
