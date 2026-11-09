# System Architecture: DND Gaming Hub

## Architectural Style
Modular Monolith structured into explicit domains:
- **Presentation Layer**: React (Vite) Single Page Application communicating via REST JSON.
- **Routing & Controller Layer**: Express routers mapping HTTP requests to validated controller actions.
- **Middleware Pipeline**: Security (Helmet, strict CORS), Session Management (HTTP-only cookies with `connect-mongo`), Request Sanitization & Zod validation schemas.
- **Domain Services Layer**: Authoritative business logic (`BookingEngineService`, `StationService`, `AuthService`, `PaymentService`).
- **Data Access Layer**: Mongoose schemas enforcing database constraints and relational references.
- **Database Engine**: MongoDB Replica Set (supporting multi-document ACID transactions with majority read/write concerns).

## Concurrency-Safe Booking Engine Design

### Problem: TOCTOU (Time of Check to Time of Use)
Standard `find(overlap) -> create()` logic permits double bookings under simultaneous requests due to concurrent execution before writes commit.

### Solution: Discrete Reservation Slots with Unique Compound Constraint
1. All bookable operating time is discretized into fixed 15-minute quanta: `XX:00, XX:15, XX:30, XX:45`.
2. A 60-minute booking requires 4 discrete slot timestamps. A 90-minute booking requires 6 discrete slot timestamps.
3. Every slot is persisted in the `ReservationSlot` collection with a unique compound index:
   ```javascript
   ReservationSlotSchema.index({ stationId: 1, slotStartTime: 1 }, { unique: true });
   ```
4. Booking creation executes in an atomic MongoDB transaction:
   - On-demand expired slots reclamation deletes stale `HELD` slots whose `expiresAt <= now`.
   - The batch of discrete slots is inserted with `status: 'HELD'`.
   - If ANY slot is already occupied, MongoDB throws duplicate key error `E11000`.
   - The transaction immediately rolls back all partial writes, returning HTTP 409 Conflict.
5. Adjacent intervals `[17:00, 18:00)` and `[18:00, 19:00)` share boundary 18:00 without colliding because the first uses slots `17:00, 17:15, 17:30, 17:45` and the second starts at `18:00`.

## State Machine

### Booking States
- `PENDING_HOLD`: Temporary 10-minute hold awaiting payment.
- `CONFIRMED`: Payment verified or walk-in authorized.
- `ACTIVE`: Station checked in and session currently running.
- `COMPLETED`: Session concluded.
- `CANCELLED`: Released prior to session per cancellation rules.
- `NO_SHOW`: Customer failed to arrive within grace period.
- `EXPIRED`: Hold elapsed without completed payment.

### Slot States
- `HELD`: Locked under a pending reservation with `expiresAt`.
- `CONFIRMED`: Permanently reserved for confirmed booking.
- `MAINTENANCE`: Blocked for scheduled station maintenance.
k