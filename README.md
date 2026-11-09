# DND Gaming Hub

> A modern, real-time gaming lounge booking and management application built with a high-integrity, concurrency-safe booking engine.

## Overview

DND Gaming Hub provides:
- **Customers**: Browse gaming stations (PCs, PS5s), check live availability on 15-minute intervals, make reservations (registered or guest), and manage bookings.
- **Lounge Management**: Live calendar view, walk-in reservation entry, session timer control (Start, Complete, No-Show, Extend), station maintenance blocking, and revenue summaries.
- **Engineering Guarantee**: Guaranteed zero double bookings using a discrete reservation-slot architecture backed by MongoDB multi-document ACID transactions and unique compound constraints.

## Tech Stack

- **Backend**: Node.js, Express.js, Mongoose, Zod, Passport.js, Helmet, CORS
- **Database**: MongoDB (Replica Set required for multi-document ACID transactions)
- **Frontend**: React (Vite), Tailwind CSS, React Router, Lucide Icons
- **Testing**: Vitest, Supertest, MongoMemoryReplSet (for transactional integration tests), Playwright, k6

## Project Structure

```
dnd-gaming-hub/
├── client/          # Vite + React frontend application
├── server/          # Node.js + Express backend modular monolith
├── docs/            # Architecture, API specifications, and design documents
├── package.json     # Root management scripts
└── .gitignore
```

## Quick Start

### 1. Prerequisites
- Node.js (v18+ or v20+ recommended)
- MongoDB (Local Replica Set or free MongoDB Atlas cluster)

### 2. Setup & Installation
```bash
# Install root, server, and client dependencies
npm run install:all
```

### 3. Environment Variables
Copy `.env.example` in both `server/` and `client/` to `.env` and fill in required values:
```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```

### 4. Running the Development Servers
```bash
# Run server (defaults to http://localhost:5000)
npm run dev:server

# In a separate terminal, run client (defaults to http://localhost:5173)
npm run dev:client
```

### 5. Running Tests
```bash
# Run server unit & integration test suite (includes transactional MongoDB tests)
npm run test:server
```
