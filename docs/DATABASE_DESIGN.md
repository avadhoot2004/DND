# Database Design: DND Gaming Hub

## Engine Requirements
- **MongoDB**: Version 6.0+
- **Replica Set**: Required for multi-document ACID transactions (`session.withTransaction()`).

## Models & Schemas

### 1. User (`users`)
- `_id`: ObjectId
- `email`: String (required, lowercase, trim, unique)
- `passwordHash`: String (required, bcrypt salt rounds >= 12)
- `fullName`: String (required, trim)
- `phoneNumber`: String (optional)
- `role`: String (enum: `['CUSTOMER', 'STAFF', 'ADMIN']`, default: `'CUSTOMER'`)
- `isActive`: Boolean (default: `true`)
- `timestamps`: `createdAt`, `updatedAt`
- **Indexes**:
  - `{ email: 1 }` (unique)

### 2. Station (`stations`)
- `_id`: ObjectId
- `identifier`: String (e.g. `'PC-01'`, `'PS5-01'`, required, uppercase, unique)
- `name`: String (required)
- `type`: String (enum: `['PC', 'PS5', 'XBOX', 'VR']`, required)
- `hourlyRatePaise`: Number (integer in Paise, e.g. 15000 = ₹150.00, required)
- `description`: String
- `specs`: Object (CPU, GPU, RAM, Peripherals, Display)
- `status`: String (enum: `['AVAILABLE', 'MAINTENANCE', 'DEACTIVATED']`, default: `'AVAILABLE'`)
- `timestamps`: `createdAt`, `updatedAt`
- **Indexes**:
  - `{ identifier: 1 }` (unique)
  - `{ type: 1, status: 1 }`

### 3. ReservationSlot (`reservation_slots`)
- `_id`: ObjectId
- `stationId`: ObjectId (ref: `'Station'`, required)
- `slotStartTime`: Date (required, aligned to 15-minute quantum: 00, 15, 30, 45)
- `bookingId`: ObjectId (ref: `'Booking'`, optional if maintenance)
- `maintenanceBlockId`: ObjectId (ref: `'MaintenanceBlock'`, optional)
- `status`: String (enum: `['HELD', 'CONFIRMED', 'MAINTENANCE']`, required)
- `expiresAt`: Date (set only when status === 'HELD')
- **Indexes**:
  - `{ stationId: 1, slotStartTime: 1 }` — **UNIQUE INDEX**
  - `{ bookingId: 1 }`
  - `{ maintenanceBlockId: 1 }`
  - `{ expiresAt: 1 }` (sparse index for query optimization)

### 4. Booking (`bookings`)
- `_id`: ObjectId
- `bookingReference`: String (e.g. `'DND-20261025-A8F2'`, required, uppercase, unique)
- `stationId`: ObjectId (ref: `'Station'`, required)
- `customerId`: ObjectId (ref: `'User'`, optional if guest)
- `isGuest`: Boolean (default: `false`)
- `guestInfo`: Object (`{ fullName, email, phone }`, required if `isGuest: true`)
- `guestAccessTokenHash`: String (SHA-256 hash of random 32-byte secret token)
- `startTime`: Date (required)
- `endTime`: Date (required)
- `durationMinutes`: Number (required, multiple of 15)
- `priceSnapshot`: Object:
  - `hourlyRatePaise`: Number (integer)
  - `totalAmountPaise`: Number (integer)
  - `depositAmountPaise`: Number (integer)
- `bookingStatus`: String (enum: `['PENDING_HOLD', 'CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'EXPIRED']`, default: `'PENDING_HOLD'`)
- `paymentStatus`: String (enum: `['UNPAID', 'PARTIALLY_PAID', 'PAID', 'REFUNDED', 'PAID_AFTER_EXPIRATION']`, default: `'UNPAID'`)
- `paymentType`: String (enum: `['FULL', 'DEPOSIT', 'WALK_IN_CASH']`)
- `holdExpiresAt`: Date
- `checkInTime`: Date
- `checkOutTime`: Date
- `notes`: String
- `timestamps`: `createdAt`, `updatedAt`
- **Indexes**:
  - `{ bookingReference: 1 }` (unique)
  - `{ stationId: 1, startTime: 1, endTime: 1 }`
  - `{ customerId: 1, createdAt: -1 }`
  - `{ bookingStatus: 1, holdExpiresAt: 1 }`

### 5. MaintenanceBlock (`maintenance_blocks`)
- `_id`: ObjectId
- `stationId`: ObjectId (ref: `'Station'`, required)
- `startTime`: Date (required, aligned to 15-minute quantum)
- `endTime`: Date (required, aligned to 15-minute quantum)
- `reason`: String (required)
- `status`: String (enum: `['SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED']`, default: `'SCHEDULED'`)
- `createdBy`: ObjectId (ref: `'User'`, required)
- `timestamps`: `createdAt`, `updatedAt`
- **Indexes**:
  - `{ stationId: 1, startTime: 1, endTime: 1 }`

### 6. Payment (`payments`)
- `_id`: ObjectId
- `bookingId`: ObjectId (ref: `'Booking'`, required)
- `provider`: String (enum: `['RAZORPAY', 'SIMULATED', 'CASH']`, default: `'SIMULATED'`)
- `providerOrderId`: String (unique, sparse)
- `providerPaymentId`: String (sparse)
- `providerSignature`: String (sparse)
- `amountPaise`: Number (integer, required)
- `currency`: String (default: `'INR'`)
- `status`: String (enum: `['CREATED', 'SUCCESS', 'FAILED', 'REFUNDED']`, default: `'CREATED'`)
- `refundStatus`: String (enum: `['NONE', 'PENDING', 'PROCESSED', 'FAILED']`, default: `'NONE'`)
- `refundId`: String (sparse)
- `refundAttemptCount`: Number (default: 0)
- `refundIdempotencyKey`: String (unique, sparse)
- `idempotencyKey`: String (unique, sparse)
- `rawWebhookPayload`: Object
- `timestamps`: `createdAt`, `updatedAt`
- **Indexes**:
  - `{ providerOrderId: 1 }` (unique, sparse)
  - `{ bookingId: 1 }`
  - `{ refundIdempotencyKey: 1 }` (unique, sparse)
