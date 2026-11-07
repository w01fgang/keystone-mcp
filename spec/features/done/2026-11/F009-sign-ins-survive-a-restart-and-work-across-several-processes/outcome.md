# Outcome

With the new sixth option `secret`, MCP sign-ins survive a restart and work across several processes behind one host. The client registration, the sign-in page, the code and the tokens are AES-256-GCM values bound to their kind and path, so the server keeps no OAuth state. Without `secret`, the memory stores stay, and the mount log line says that sign-ins end at restart. Package commit `e75942a`, closed in `a2a2742`; the independent review passed it with no blocking finding (`review-1.md`).

Proof: live runs of two `keystone start` processes of the shop example (sign-in across processes, a restart with no new sign-in, a control run without `secret`) are in the worker's job folder. The coordinator ran 138 of 138 tests, typecheck and build at `e75942a`, with saved logs. The reviewer observed that each kind of sealed value is refused where another kind, client, path or resource is expected.

The next reader must know: a code lives 5 minutes (the ticket said 10 by mistake). The owner accepted that a sealed grant cannot detect reuse or be revoked early. A sign-in page also counts its 5 password tries only in the process that handled it; the README lists this with the other limits.
