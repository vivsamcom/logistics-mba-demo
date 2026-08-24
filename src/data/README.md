# Mock logistics seed data

The `seed` directory contains the small, fictional, deterministic dataset used
by the QBR demo. The in-memory repository deep-copies these files at startup
and whenever `POST /api/demo/reset` is called.

Shipment `serviceDate` values are deliberately `null` in the seed. The
repository stamps them with the server's current local system date in memory,
derives `expectedDeliveryDate` using `expectedDeliveryDayOffset`, and refreshes
both dates after local midnight.

`serviceDate` is an operating date, while `pickupTime` and `eta` are local
appointment times. These local values remain separate until an upstream system
supplies timezone-aware `pickupAt` and `expectedDeliveryAt` values. A future
migration should prefer ISO 8601 timestamps with explicit offsets and retain
`serviceDate` only when it has separate business meaning.

Runtime changes are never written back to these JSON files. This makes reset
reliable and avoids depending on persistent local storage when the application
is deployed to Render. In-memory assignment event IDs are also cleared by
reset.

`seed/users.json` contains fictional WhatsApp-to-persona mappings for the
MBA-facing APIs. Phone values are normalized to digits before lookup. They are
demo identifiers only and must not be replaced with real personal numbers in
source control.
