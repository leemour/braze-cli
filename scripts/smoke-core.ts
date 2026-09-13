// Second runtime. Core claims to run outside Node; this proves one non-Node runtime imports it,
// builds a request and handles a response. Run: `pnpm smoke:bun`.
import { BrazeClient } from "../packages/core/src/index.js"
import { brazeResponses, mockBraze } from "../packages/core/src/testing/index.js"

const braze = mockBraze([brazeResponses.rateLimited({ retryAfterSeconds: 2 }), brazeResponses.ok()])

const client = new BrazeClient({
  endpoint: "https://rest.fra-01.braze.eu",
  apiKey: "smoke",
  fetch: braze.fetch,
  sleep: () => new Promise(() => {}),
})

const limited = await client.send({ method: "GET", path: "/campaigns/list", query: { page: 0 } })
const ok = await client.send({ method: "POST", path: "/users/track", body: { attributes: [] } })

if (limited.response.status !== 429 || ok.response.status !== 200) {
  throw new Error(`unexpected statuses: ${limited.response.status}, ${ok.response.status}`)
}
if (braze.lastRequest().headers.get("authorization") !== "Bearer smoke") {
  throw new Error("the client did not authenticate the request")
}

const runtime = typeof Bun !== "undefined" ? `bun ${Bun.version}` : "an unknown runtime"
console.log(
  `core sent ${braze.requests.length} requests under ${runtime}, ${limited.requestId.length}-char request ids`,
)
