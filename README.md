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
- Mock drivers, shipments, assignment events, and exceptions
  held in memory
- Idempotent load-assignment creation
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
| GET | `/api/shipments/today` | Current system-date summary |
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
| POST | `/api/assignments` | Create a new load assignment |
| GET | `/api/exceptions` | Active exceptions; supports `?status=ACTIVE` |
| POST | `/api/demo/reset` | Restore the original demo seed |

The future MBA layer can understand language, gather missing information,
confirm actions, and invoke these APIs. It should obtain impact and driver
availability from the backend rather than calculating them itself.

## Create a load assignment

`POST /api/assignments` creates an assignment for an unassigned shipment. It
updates the shipment, creates a pending assignment, updates the driver's
current or next shipment, and records a `LOAD_ASSIGNED` event for the future
outbound notification adapter. The endpoint does not send WhatsApp messages
yet.

Request:

```bash
curl -X POST http://localhost:3000/api/assignments \
  -H "Content-Type: application/json" \
  -d '{"eventId":"ASSIGN-0001","shipmentId":"SHP-1092","driverId":"DRV-203"}'
```

All three fields are required:

- `eventId` is the caller-provided idempotency key.
- `shipmentId` must identify an existing shipment.
- `driverId` must identify an existing driver with an open current or next
  assignment slot, depending on the shipment status.

The first successful request returns `201`. Repeating the exact event returns
`200` with `data.idempotent: true` and does not create another assignment.
Reusing an `eventId` with different IDs returns `ASSIGNMENT_EVENT_CONFLICT`.
Trying to overwrite an active assignment returns
`SHIPMENT_ALREADY_ASSIGNED`; use the existing reassignment API for that
operation.

The response contains the stored event, updated assignment, shipment, driver,
and a notification-ready payload. For example:

```json
{
  "data": {
    "idempotent": false,
    "event": {
      "eventId": "ASSIGN-0001",
      "type": "LOAD_ASSIGNED",
      "shipmentId": "SHP-1092",
      "driverId": "DRV-203",
      "occurredAt": "2026-08-21T10:30:00.000Z"
    },
    "notification": {
      "channel": "WHATSAPP",
      "recipient": {
        "driverId": "DRV-203",
        "phone": "+15550000203"
      },
      "template": {
        "name": "new_load_assignment_v1",
        "category": "UTILITY",
        "language": "en_US",
        "bodyParameters": [
          { "position": 1, "name": "shipment", "value": "SHP-1092" },
          { "position": 2, "name": "pickup", "value": "Chennai Port" },
          { "position": 3, "name": "delivery", "value": "Hyderabad Distribution Center" },
          { "position": 4, "name": "pickupDateTime", "value": "21 Aug, 3:00 PM" },
          { "position": 5, "name": "expectedDeliveryDateTime", "value": "21 Aug, 11:00 PM" }
        ],
        "buttons": [
          {
            "index": 0,
            "type": "QUICK_REPLY",
            "text": "Accept",
            "action": "ACCEPT",
            "payload": "ASSIGNMENT:ACCEPT:SHP-1092:DRV-203"
          },
          {
            "index": 1,
            "type": "QUICK_REPLY",
            "text": "Reject",
            "action": "REJECT",
            "payload": "ASSIGNMENT:REJECT:SHP-1092:DRV-203"
          }
        ]
      }
    }
  }
}
```

The parameter positions map directly to the utility template:

```text
New shipment assigned

Shipment {{1}} has been assigned to you.

Pickup: {{2}}
Delivery: {{3}}
Pickup Date & Time: {{4}}
Expected Delivery Date & Time: {{5}}

Please review and confirm the assignment.

Quick Reply buttons (configured separately from the body):
1. Accept
2. Reject
```

The service validates the driver's phone number and all five body parameter
values before changing assignment state. Button payloads include the action,
shipment ID, and driver ID needed to correlate a future webhook reply. The
future WhatsApp adapter will still need to map this object to Meta's wire
format, send it with the configured credentials, and process the callback.

Assignment event records are in memory and are cleared by
`POST /api/demo/reset`. The caller is treated as the assignment
decision-maker, so this endpoint does not run the available-driver
recommendation rule. It does prevent a driver from receiving two current
shipments or two next shipments.

## Shipment date and time model

The current model intentionally keeps local dates and times separate:

- `serviceDate` is the business operating date used by the daily summary and
  resettable demo dataset.
- `pickupTime` is the local appointment time in `HH:mm` format and is used by
  the current driver-availability rule.
- `expectedDeliveryDate` is calculated in memory from the service date and
  the seed's demo-only `expectedDeliveryDayOffset`.
- `eta` supplies the expected delivery time in `HH:mm` format.

They should not be replaced with a generated `pickupAt` yet. The current data
does not include an IANA timezone or UTC offset, so a generated timestamp
would be ambiguous outside the server's local timezone and would duplicate
the existing fields. The notification payload formats the local values as
`D MMM, h:mm AM/PM` for the current single-timezone demo.

When the upstream system supplies timezone-aware timestamps, the preferred
migration is to store one canonical ISO 8601 value such as
`2027-08-25T10:00:00+05:30` in `pickupAt` and derive display dates and times
from it. Keep `serviceDate` only if it continues to represent a separate
business/operating date.

## Dataset and deterministic demo rules

The seed contains five fictional shipments and five fictional drivers using
dummy phone numbers. It includes:

- Raj (`DRV-101`) on current shipment `SHP-1024`, with `SHP-1088` next
- Amit (`DRV-203`) and Sunil (`DRV-218`) available for `SHP-1088`
- Two scheduled, two in-transit, and one delayed shipment
- One initial active exception on `SHP-1099`

Seed shipments are stamped in memory with the server's current local system
date at startup and reset. A long-running process also refreshes shipment dates
after local midnight. The JSON seed keeps `serviceDate` as `null`, and runtime
changes are not written back to it. Summary counts are calculated from current
in-memory state.

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
the recorded `LOAD_ASSIGNED` event and exception events. MBA connector
schemas/configuration can map to the generic REST APIs while transportation
decisions remain in the backend or its future platform adapter.
