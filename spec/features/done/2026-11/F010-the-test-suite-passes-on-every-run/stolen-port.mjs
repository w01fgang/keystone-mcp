// Catches another program that answers on the port of a test server. Run while the machine is busy, for example
// during parallel `npx vitest run` loops:
//   node spec/features/active/F010-the-test-suite-passes-on-every-run/stolen-port.mjs [host] [seconds]
// It starts COUNT servers with `listen(0, host)` (no host: all interfaces, as the tests did) and requests each one
// through http://127.0.0.1:<port> once a second. A response without this process's id header came from another
// program; the script prints the status, the headers, and the `lsof` owners of that port.
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';

const COUNT = 300;
const host = process.argv[2] === 'all' ? undefined : process.argv[2];
const seconds = Number(process.argv[3] ?? 120);
const id = String(process.pid);

const servers = [];
for (let i = 0; i < COUNT; i++) {
  const server = createServer((_req, res) => res.writeHead(200, { 'x-watcher': id }).end()).listen(0, host);
  await once(server, 'listening');
  servers.push(server);
}
const ports = servers.map((server) => server.address().port);
console.log(`${COUNT} servers on ${host ?? 'all interfaces'}, ${seconds} s`);

let requests = 0;
const missed = new Map();
const deadline = Date.now() + seconds * 1000;
while (Date.now() < deadline) {
  for (const port of ports) {
    requests++;
    let reason;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST' });
      if (response.headers.get('x-watcher') === id) continue;
      reason = `answered by another program: ${response.status} ${JSON.stringify([...response.headers])}`;
    } catch (error) {
      reason = `request failed: ${error.cause?.code ?? error.message}`;
    }
    missed.set(port, (missed.get(port) ?? 0) + 1);
    if (missed.get(port) > 1) continue;
    const listeners = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
    console.log(`port ${port}: ${reason}; the listeners on the port:\n${listeners}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
const total = [...missed.values()].reduce((sum, count) => sum + count, 0);
console.log(`${requests} requests, ${total} not answered by the test servers, on ${missed.size} ports`);
await Promise.all(servers.map((server) => once(server.close(), 'close')));
