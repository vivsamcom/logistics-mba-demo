# logistics-mba-demo

`logistics-mba-demo` is a Node.js/Express service for a generic logistics and
Meta Business Agent demo. It contains a WhatsApp Business Platform webhook,
an outbound load-assignment template adapter, and a small, resettable mock
transportation backend.

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
- Optional outbound load-assignment and dispatcher exception-alert WhatsApp
  utility notifications
- Driver current-trip and assignment APIs
- Shipment summary, delayed-shipment, exception, impact, and available-driver
  APIs
- Assignment response, exception reporting, and shipment reassignment actions
- `POST /api/demo/reset` for repeatable rehearsals
- Persona-aware MBA APIs that resolve Drivers and Dispatchers from the
  `X-WhatsApp-Phone` request header
- Backend-enforced Driver and Dispatcher role boundaries for MBA-facing routes

There is no external logistics-platform connection, database, optimizer,
queue, LLM, MBA configuration, or production persistence in this phase.
Load tendering, carriers, vehicles, appointment scheduling, and tracking-event
resources are not implemented in the current codebase.

## Architecture and integration boundary

```text
WhatsApp Business Platform
          |
          | webhook / Cloud API
          v
+----------------------------------------------------+
| logistics-mba-demo (one Express application)      |
|                                                    |
| WhatsApp webhook + outbound template adapter       |
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

## Public WhatsApp images

The service exposes the PNG files in `public/images` without authentication:

- `/images/breakdown-image.png`
- `/images/load-assignment-header.png`

Locally, for example, the load-assignment header is available at
`http://localhost:3000/images/load-assignment-header.png`. After deploying the
service behind a public HTTPS domain, use URLs such as:

```text
https://your-domain.com/images/breakdown-image.png
https://your-domain.com/images/load-assignment-header.png
```

These image requests do not require an API key or access token. The deployed
domain itself must be publicly reachable so Meta can download the image.

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
WHATSAPP_GRAPH_API_VERSION=
WHATSAPP_ASSIGNMENT_HEADER_IMAGE_URL=https://logistics-mba-demo.onrender.com/images/load-assignment-header.png
WHATSAPP_EXCEPTION_HEADER_IMAGE_URL=https://logistics-mba-demo.onrender.com/images/breakdown-image.png
WHATSAPP_NOTIFICATIONS_ENABLED=false
```

Never commit `.env`. Set `WHATSAPP_NOTIFICATIONS_ENABLED=true` only after the
access token, sender phone-number ID, and a currently supported Graph API
version are configured. `WHATSAPP_ASSIGNMENT_HEADER_IMAGE_URL` can override the
default public image URL used by the load-assignment template, and
`WHATSAPP_EXCEPTION_HEADER_IMAGE_URL` can override the exception-alert image.
`WHATSAPP_BUSINESS_ACCOUNT_ID` is not used by the send call, but remains
available for template-management operations.

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

## Persona-aware MBA APIs

Meta Business Agent connector tools can call an MBA-facing layer without
inventing or asking the user for a driver or dispatcher ID. The connector
supplies the current WhatsApp sender in the request header:

```http
X-WhatsApp-Phone: 919823784110
```

The backend removes all non-digit characters and resolves the normalized
number against the fictional mappings in `src/data/seed/users.json`:

| Demo phone | Role | Entity | Name |
|---|---|---|---|
| `919823784110` | `DRIVER` | `DRV-101` | Raj |
| `919511758488` | `DISPATCHER` | `DSP-001` | Anita |

These formatted Driver values all resolve to the same persona:
`+91 98237 84110`, `919823784110`, and `91-98237-84110`. Unknown numbers are
never assigned a default role. A missing header returns
`WHATSAPP_PHONE_REQUIRED`; an unmapped number returns `PERSONA_NOT_FOUND`.

The new endpoints reuse the same services and in-memory data as the generic
mock TMS endpoints:

| Method | Endpoint | Role | Purpose |
|---|---|---|---|
| GET | `/api/me/persona` | Driver or Dispatcher | Verify connector persona resolution |
| GET | `/api/me/current-trip` | Driver | Current Driver trip |
| GET | `/api/me/assignments` | Driver | Current and upcoming Driver assignments |
| POST | `/api/me/assignments/:shipmentId/respond` | Driver | Accept or reject the Driver's assignment |
| POST | `/api/me/shipments/:shipmentId/exceptions` | Driver | Report an exception for the Driver's shipment |
| GET | `/api/dispatcher/shipments/today` | Dispatcher | Current shipment summary |
| GET | `/api/dispatcher/shipments/delayed` | Dispatcher | Delayed shipments |
| GET | `/api/dispatcher/exceptions` | Dispatcher | Active or resolved fleet exceptions |
| GET | `/api/dispatcher/shipments/:shipmentId` | Dispatcher | Shipment details |
| GET | `/api/dispatcher/shipments/:shipmentId/impact` | Dispatcher | Direct or downstream impact from backend rules |
| GET | `/api/dispatcher/shipments/:shipmentId/available-drivers` | Dispatcher | Available drivers from existing backend rules |
| POST | `/api/dispatcher/shipments/:shipmentId/reassign` | Dispatcher | Confirmed shipment reassignment |

The diagnostic endpoint deliberately omits the full phone number:

```bash
curl -H "X-WhatsApp-Phone: 919823784110" \
  http://localhost:3000/api/me/persona
```

Driver current trip and assignments:

```bash
curl -H "X-WhatsApp-Phone: 919823784110" \
  http://localhost:3000/api/me/current-trip

curl -H "X-WhatsApp-Phone: 919823784110" \
  http://localhost:3000/api/me/assignments
```

Driver assignment acceptance:

```bash
curl -X POST \
  -H "X-WhatsApp-Phone: 919823784110" \
  -H "Content-Type: application/json" \
  -d '{"response":"ACCEPT"}' \
  http://localhost:3000/api/me/assignments/SHP-1024/respond
```

Driver exception reporting derives `DRV-101` from the header and does not
accept a caller-selected `driverId`. A successful report also sends the
approved `shipment_exception_alert_v1` utility template to the configured
Dispatcher persona:

```bash
curl -X POST \
  -H "X-WhatsApp-Phone: 919823784110" \
  -H "Content-Type: application/json" \
  -d '{"type":"VEHICLE_BREAKDOWN","location":"Near Pune","delayMinutes":90}' \
  http://localhost:3000/api/me/shipments/SHP-1024/exceptions
```

Dispatcher delayed shipments, impact, and available drivers:

```bash
curl -H "X-WhatsApp-Phone: 919511758488" \
  http://localhost:3000/api/dispatcher/shipments/delayed

curl -H "X-WhatsApp-Phone: 919511758488" \
  http://localhost:3000/api/dispatcher/shipments/SHP-1088/impact

curl -H "X-WhatsApp-Phone: 919511758488" \
  http://localhost:3000/api/dispatcher/shipments/SHP-1088/available-drivers
```

Dispatcher reassignment:

```bash
curl -X POST \
  -H "X-WhatsApp-Phone: 919511758488" \
  -H "Content-Type: application/json" \
  -d '{"newDriverId":"DRV-203"}' \
  http://localhost:3000/api/dispatcher/shipments/SHP-1088/reassign
```

The persona layer is an authorization/context wrapper for the MBA demo. The
generic mock TMS routes below intentionally remain header-free for Postman,
direct testing, and demo administration. `X-WhatsApp-Phone` is not a
replacement for authenticating the connector in production.

## Mock logistics APIs

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/shipments/today` | Current system-date summary |
| GET | `/api/shipments/delayed` | Current delayed shipments |
| GET | `/api/shipments/:shipmentId` | Shipment, driver, assignment, and exceptions |
| GET | `/api/shipments/:shipmentId/exceptions` | Shipment exception history |
| POST | `/api/shipments/:shipmentId/exceptions` | Record a driver-reported exception |
| GET | `/api/shipments/:shipmentId/impact` | Mock direct or downstream risk supplied by the backend |
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
current or next shipment, records a `LOAD_ASSIGNED` event, and sends the
approved `new_load_assignment_v1` template when WhatsApp notifications are
enabled.

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
        "header": {
          "format": "IMAGE",
          "image": {
            "link": "https://logistics-mba-demo.onrender.com/images/load-assignment-header.png"
          }
        },
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
    },
    "notificationDelivery": {
      "status": "ACCEPTED_BY_META",
      "attemptedAt": "2026-08-21T10:30:01.000Z",
      "messageId": "wamid.example"
    }
  }
}
```

The parameter positions map directly to the utility template:

```text
🚛 New shipment assigned
Shipment {{1}} has been assigned to you.
📍 Pickup: {{2}}
🏁 Delivery: {{3}}
📆 Pickup Date & Time: {{4}}
🕒 Expected Delivery Date & Time: {{5}}

Please review and confirm the assignment.
```

The service validates the driver's phone number and all five body parameter
values before changing assignment state. The outbound adapter removes display
formatting from the recipient number, validates and maps the HTTPS image header,
preserves body-parameter order, and maps the five body values to Meta's template
wire format. Existing button metadata is retained in the API response for
compatibility; the approved template does not require dynamic button parameters.

Meta accepting a request is recorded as `ACCEPTED_BY_META` with its `wamid`;
actual delivery statuses continue to arrive through the webhook. A Meta or
configuration error is returned as `notificationDelivery.status: FAILED`
without rolling back the assignment. Repeating the same idempotent event
retries a failed send and does not repeat an already accepted send. When
outbound notifications are disabled, the status is `SKIPPED`.

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
- A shipment with its own active delay is directly impacted. Otherwise, it is
  impacted when the same driver's preceding assignment has an active delay.
  In a direct impact, `sourceShipmentId` is the requested shipment itself.
  Delays of 60 minutes or more are `HIGH`; shorter delays are `MEDIUM`.
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

2. Assign `SHP-1024` to Raj. This sends the load-assignment utility template
when WhatsApp notifications are enabled:

```bash
curl -X POST http://localhost:3000/api/assignments \
  -H "Content-Type: application/json" \
  -d '{"eventId":"ASSIGN-DEMO-1024","shipmentId":"SHP-1024","driverId":"DRV-101"}'
```

3. Accept the assignment as Raj:

```bash
curl -X POST \
  -H "X-WhatsApp-Phone: 919823784110" \
  -H "Content-Type: application/json" \
  -d '{"response":"ACCEPT"}' \
  http://localhost:3000/api/me/assignments/SHP-1024/respond
```

4. Report the vehicle breakdown as Raj. This sends the dispatcher exception
alert when WhatsApp notifications are enabled:

```bash
curl -X POST \
  -H "X-WhatsApp-Phone: 919823784110" \
  -H "Content-Type: application/json" \
  -d '{"type":"VEHICLE_BREAKDOWN","reason":"Truck breakdown","location":"Near Pune","delayMinutes":90}' \
  http://localhost:3000/api/me/shipments/SHP-1024/exceptions
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

7. Find available replacement drivers for `SHP-1024`:

```bash
curl http://localhost:3000/api/shipments/SHP-1024/available-drivers
```

8. Reassign `SHP-1024` to Amit (`DRV-203`):

```bash
curl -X POST http://localhost:3000/api/shipments/SHP-1024/reassign \
  -H "Content-Type: application/json" \
  -d '{"newDriverId":"DRV-203"}'
```

9. Verify the shipment and Amit's assignment:

```bash
curl http://localhost:3000/api/shipments/SHP-1024
curl http://localhost:3000/api/drivers/DRV-203/assignments
```

10. Reset again for the next rehearsal:

```bash
curl -X POST http://localhost:3000/api/demo/reset
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

## WhatsApp utility notifications

Configure the sender credentials in `.env` or in the deployment environment:

```env
WHATSAPP_ACCESS_TOKEN=<system-user-token-with-whatsapp_business_messaging>
WHATSAPP_PHONE_NUMBER_ID=<meta-sender-phone-number-id>
WHATSAPP_GRAPH_API_VERSION=<supported-version-shown-by-meta>
WHATSAPP_ASSIGNMENT_HEADER_IMAGE_URL=https://logistics-mba-demo.onrender.com/images/load-assignment-header.png
WHATSAPP_EXCEPTION_HEADER_IMAGE_URL=https://logistics-mba-demo.onrender.com/images/breakdown-image.png
WHATSAPP_NOTIFICATIONS_ENABLED=true
```

Load assignments use the assigned driver's existing `phone` field. Driver
exception alerts use the first `DISPATCHER` persona in `seed/users.json`.
Fictional phone numbers will be rejected by Meta, and a Meta test sender can
send only to recipients allowed in the app dashboard. The Cloud API request is:

```text
POST https://graph.facebook.com/{version}/{phone-number-id}/messages
```

### End-to-end assignment notification check

In the seed data, the real demo WhatsApp number belongs to `DRV-101`. Reset the
demo and assign `SHP-1024` directly to that driver:

```bash
curl -X POST https://logistics-mba-demo.onrender.com/api/demo/reset

curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"eventId":"ASSIGN-LIVE-0001","shipmentId":"SHP-1024","driverId":"DRV-101"}' \
  https://logistics-mba-demo.onrender.com/api/assignments
```

The last response should contain
`data.notificationDelivery.status: "ACCEPTED_BY_META"`, a `messageId`, and
`data.notification.recipient.phone: "+919823784110"`. A later webhook status
of `delivered` confirms delivery to WhatsApp.

### End-to-end exception alert check

After assigning `SHP-1024` to Raj, report the exception through the Driver
persona endpoint:

```bash
curl -X POST \
  -H "X-WhatsApp-Phone: 919823784110" \
  -H "Content-Type: application/json" \
  -d '{"type":"VEHICLE_BREAKDOWN","location":"Near Pune","delayMinutes":90}' \
  https://logistics-mba-demo.onrender.com/api/me/shipments/SHP-1024/exceptions
```

The response includes the generated `shipment_exception_alert_v1` payload and
`data.notificationDelivery`. `ACCEPTED_BY_META` contains the `wamid`; a later
`delivered` webhook status confirms arrival at the Dispatcher number.

### Render diagnostics

Outbound results are written as single-line structured JSON to stdout/stderr,
so they appear in the Render service's **Logs** page. Search for these events:

- `whatsapp.assignment.accepted`
- `whatsapp.assignment.failed`
- `whatsapp.exception.accepted`
- `whatsapp.exception.failed`

A failure log contains the assignment event or exception, shipment, driver,
masked recipient, template name/language, HTTP status, Meta error details,
trace and request IDs, and Render's `Rndr-Id` correlation value. Access tokens
and complete recipient phone numbers are never logged. Example:

```json
{
  "level": "error",
  "event": "whatsapp.assignment.failed",
  "requestId": "render-request-id",
  "eventId": "ASSIGN-0001",
  "shipmentId": "SHP-1092",
  "driverId": "DRV-203",
  "recipient": "*******0203",
  "templateName": "new_load_assignment_v1",
  "templateLanguage": "en_US",
  "code": "132001",
  "message": "Template does not exist in the specified language",
  "httpStatus": 400,
  "meta": {
    "subcode": "2494073",
    "traceId": "meta-trace-id",
    "requestId": "meta-request-id"
  }
}
```

## Tests and deployment

Run all webhook and mock logistics tests with:

```bash
npm test
```

The service remains suitable for one future Render Web Service: it uses
`process.env.PORT`, exposes `/health`, stores secrets in environment variables,
does not hardcode its callback host, and does not write runtime state to disk.

A future phase can process assignment confirmation replies directly from
WhatsApp. MBA connector schemas/configuration can map to the generic REST APIs
while transportation decisions remain in the backend or its future platform
adapter.
