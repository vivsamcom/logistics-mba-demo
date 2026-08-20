# logistics-mba-demo

`logistics-mba-demo` is a Node.js/Express service for a generic logistics and
Meta Business Agent demo. It contains a WhatsApp Business Platform webhook
foundation and a small, resettable mock transportation backend.

The service represents a vendor-neutral integration boundary that could later
connect to a transportation management system (TMS), fleet management system
(FMS), carrier platform, shipment tracker, or another enterprise logistics
system. It does not reproduce or claim to expose any vendor's product APIs.

## Current scope

- `GET /health` service health check
- `GET /webhook` Meta webhook verification
- `POST /webhook` WhatsApp callback handling with optional raw-body signature
  validation
- Mock drivers, shipments, assignments, and exceptions held in memory
- Driver current-trip and assignment APIs
- Shipment summary, delayed-shipment, exception, impact, and available-driver
  APIs
- Assignment response, exception reporting, and shipment reassignment actions
- `POST /api/demo/reset` for repeatable rehearsals

There is no external logistics-platform connection, database, optimizer,
queue, LLM, MBA configuration, or production persistence in this phase.
Load tendering, carriers, vehicles, appointment scheduling, and tracking-event
resources are not implemented in the current codebase.

## Architecture and integration boundary

```text
WhatsApp Business Platform
          |
          | webhook / future Cloud API
          v
+----------------------------------------------------+
| logistics-mba-demo (one Express application)      |
|                                                    |
| WhatsApp webhook                                   |
| Logistics routes -> services -> in-memory store   |
|                                  ^                 |
|                                  | reset/copy      |
|                            JSON seed data          |
+----------------------------------------------------+
```

Routes contain HTTP mapping only. Controllers shape responses, services own
validation and demo business behavior, and the repository owns mutable
in-memory state. Runtime changes are not written to the seed files.

The HTTP and service layers use generic logistics concepts. A future adapter
can replace the in-memory repository without changing the public API:

```text
Generic Logistics API -> platform adapter -> external logistics system
```

## Install and run

Requirements: Node.js 18 or newer and npm.

```bash
npm install
cp .env.example .env
npm run dev
```

On PowerShell, use `Copy-Item .env.example .env` instead of `cp` if needed.
The normal start command is:

```bash
npm start
```

The default URL is `http://localhost:3000`.

## Environment variables

```env
PORT=3000
NODE_ENV=development

WEBHOOK_VERIFY_TOKEN=

META_APP_SECRET=
META_SIGNATURE_VALIDATION_ENABLED=false

WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCOUNT_ID=
```

Never commit `.env`. The WhatsApp access token and account/phone IDs remain
placeholders for a future outbound messaging phase.

## API response conventions

Resources use `{ "data": {...} }`; collections add a top-level `count`.
Expected domain and validation errors use:

```json
{
  "error": {
    "code": "SHIPMENT_NOT_FOUND",
    "message": "Shipment SHP-9999 was not found"
  }
}
```

## Mock logistics APIs

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/shipments/today` | Calculated demo-day summary |
| GET | `/api/shipments/delayed` | Current delayed shipments |
| GET | `/api/shipments/:shipmentId` | Shipment, driver, assignment, and exceptions |
| GET | `/api/shipments/:shipmentId/exceptions` | Shipment exception history |
| POST | `/api/shipments/:shipmentId/exceptions` | Record a driver-reported exception |
| GET | `/api/shipments/:shipmentId/impact` | Mock downstream risk supplied by the backend |
| GET | `/api/shipments/:shipmentId/available-drivers` | Mock driver availability |
| POST | `/api/shipments/:shipmentId/reassign` | Perform a confirmed reassignment |
| GET | `/api/drivers/:driverId/current-trip` | Driver's current shipment context |
| GET | `/api/drivers/:driverId/assignments` | Ordered current/upcoming assignments |
| POST | `/api/assignments/:shipmentId/respond` | Accept or reject a pending assignment |
| GET | `/api/exceptions` | Active exceptions; supports `?status=ACTIVE` |
| POST | `/api/demo/reset` | Restore the original demo seed |

The future MBA layer can understand language, gather missing information,
confirm actions, and invoke these APIs. It should obtain impact and driver
availability from the backend rather than calculating them itself.

## Dataset and deterministic demo rules

The seed contains five fictional shipments and five fictional drivers using
dummy phone numbers. It includes:

- Raj (`DRV-101`) on current shipment `SHP-1024`, with `SHP-1088` next
- Amit (`DRV-203`) and Sunil (`DRV-218`) available for `SHP-1088`
- Two scheduled, two in-transit, and one delayed shipment
- One initial active exception on `SHP-1099`

All shipments belong to the fixed seed operating date `2026-08-19`; "today"
means that demo operating date so rehearsals do not change with the system
clock. Summary counts are calculated from current in-memory state.

The intentionally simple mock rules are:

- A positive reported delay changes a shipment to `DELAYED`.
- Revised ETA is original ETA plus total active delay minutes; this is clock
  arithmetic only, not ETA prediction.
- A target shipment is impacted when the same driver's preceding assignment
  has an active delay. Delays of 60 minutes or more are `HIGH`; shorter delays
  are `MEDIUM`.
- A driver is available when seed status is `AVAILABLE` and `availableFrom`
  is no later than the shipment pickup time.
- Reassignment updates the shipment, assignment, old driver, and new driver in
  one in-memory operation.
- Exception reporting requires the supplied driver to be assigned to the
  shipment.

## Complete demo walkthrough

Start the app, then run the following commands in order.

1. Reset the demo:

```bash
curl -X POST http://localhost:3000/api/demo/reset
```

2. Query Raj's current trip:

```bash
curl http://localhost:3000/api/drivers/DRV-101/current-trip
```

3. Query `SHP-1024`:

```bash
curl http://localhost:3000/api/shipments/SHP-1024
```

4. Report the vehicle breakdown near Pune with a 90-minute delay:

```bash
curl -X POST http://localhost:3000/api/shipments/SHP-1024/exceptions \
  -H "Content-Type: application/json" \
  -d '{"driverId":"DRV-101","type":"VEHICLE_BREAKDOWN","reason":"Truck breakdown","location":"Near Pune","delayMinutes":90}'
```

5. Verify `SHP-1024` is now delayed with ETA `18:30`:

```bash
curl http://localhost:3000/api/shipments/SHP-1024
```

6. Query active exceptions:

```bash
curl http://localhost:3000/api/exceptions
```

The response contains the initial seed exception plus the new `EX-002`.

7. Query Raj's current and next assignments:

```bash
curl http://localhost:3000/api/drivers/DRV-101/assignments
```

8. Ask whether the delay impacts next shipment `SHP-1088`:

```bash
curl http://localhost:3000/api/shipments/SHP-1088/impact
```

The backend returns `impacted: true`, `risk: HIGH`, and identifies `SHP-1024`
as the source.

9. Find available drivers for `SHP-1088`:

```bash
curl http://localhost:3000/api/shipments/SHP-1088/available-drivers
```

10. Reassign `SHP-1088` to Amit (`DRV-203`):

```bash
curl -X POST http://localhost:3000/api/shipments/SHP-1088/reassign \
  -H "Content-Type: application/json" \
  -d '{"newDriverId":"DRV-203"}'
```

11. Verify the shipment and Amit's assignment:

```bash
curl http://localhost:3000/api/shipments/SHP-1088
curl http://localhost:3000/api/drivers/DRV-203/assignments
```

12. Reset again for the next rehearsal:

```bash
curl -X POST http://localhost:3000/api/demo/reset
```

Optional pending-assignment response example after a reset:

```bash
curl -X POST http://localhost:3000/api/assignments/SHP-1088/respond \
  -H "Content-Type: application/json" \
  -d '{"driverId":"DRV-101","response":"ACCEPT"}'
```

## WhatsApp webhook

Health:

```bash
curl http://localhost:3000/health
```

GET verification:

```bash
curl "http://localhost:3000/webhook?hub.mode=subscribe&hub.verify_token=<VERIFY_TOKEN>&hub.challenge=123456"
```

A matching token returns `123456`; a wrong token returns 403. GET verification
does not use `X-Hub-Signature-256`.

With `META_SIGNATURE_VALIDATION_ENABLED=false`, local unsigned POSTs are
accepted:

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{"object":"whatsapp_business_account","entry":[]}'
```

For production-style callbacks, configure `META_APP_SECRET`, set
`META_SIGNATURE_VALIDATION_ENABLED=true`, and restart. The middleware validates
the HMAC against `req.rawBody`, the exact received bytes. It intentionally does
not use `JSON.stringify(req.body)`, which can change formatting and invalidate
a legitimate Meta signature.

## Tests and deployment

Run all webhook and mock logistics tests with:

```bash
npm test
```

The service remains suitable for one future Render Web Service: it uses
`process.env.PORT`, exposes `/health`, stores secrets in environment variables,
does not hardcode its callback host, and does not write runtime state to disk.

A future phase can add outbound WhatsApp Utility template notifications for
assignment and exception events. MBA connector schemas/configuration can map
to the generic REST APIs while transportation decisions remain in the backend
or its future platform adapter.
