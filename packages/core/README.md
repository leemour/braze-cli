# brazecli-core

The [Braze](https://www.braze.com/docs/api/basics/) REST client underneath
[`brazecli`](https://www.npmjs.com/package/brazecli): a typed operation catalog, request validation,
retries, pagination and batching.

**Web Platform APIs only.** No `node:*`, no `process`, no `Buffer`, no filesystem — everything the
environment knows is passed in as an argument, so it runs unchanged in a Cloudflare Worker, a
browser or a serverless function. Three gates in CI keep it that way.

```ts
import { BrazeClient, findOperation } from "brazecli-core"

const client = new BrazeClient({ endpoint: "https://rest.fra-01.braze.eu", apiKey })
const operation = findOperation("campaigns.list.get")
const result = await client.execute(operation, { query: { page: "0" } })
```

**Documentation, and the source:
[github.com/leemour/brazecli](https://github.com/leemour/brazecli).**

MIT.
