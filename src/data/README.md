# Mock logistics seed data

The `seed` directory contains the small, fictional, deterministic dataset used
by the QBR demo. The in-memory repository deep-copies these files at startup
and whenever `POST /api/demo/reset` is called.

Shipment `serviceDate` values are deliberately `null` in the seed. The
repository stamps them with the server's current local system date in memory
and refreshes them after local midnight.

Runtime changes are never written back to these JSON files. This makes reset
reliable and avoids depending on persistent local storage when the application
is deployed to Render.
