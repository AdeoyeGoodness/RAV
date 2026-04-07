RAV - Enterprise Digital Forensics & Endpoint Monitoring Platform

A comprehensive, enterprise-grade digital forensics and endpoint monitoring platform designed for Windows, macOS, and Linux environments.

## Features

- **USB Device Monitoring**: Track USB device insertions, removals, and file transfers
- **Network Monitoring**: Monitor active connections and DNS queries
- **Screenshot Collection**: Configurable screenshot capture with secure storage
- **Browser History**: Extract and analyze browser activity
- **Device Connectivity**: Monitor mobile/external device connections
- **Screen Recording**: Optional screen recording with encryption
- **Real-time Alerts**: Configurable alert engine for security events

## Architecture

- **Agent**: Cross-platform Rust service running on endpoints
- **Backend**: Rust-based API server with PostgreSQL and MinIO/S3 storage
- **Dashboard**: Next.js web interface for administrators and analysts

## Prerequisites

- Rust 1.70+ (for agent and backend)
- Node.js 18+ and npm (for dashboard)
- Docker and Docker Compose (for local development)

## Quick Start

### 1. Start Infrastructure Services

```bash
docker-compose up -d
```

This starts:
- PostgreSQL database (port 5432)
- MinIO object storage (ports 9000, 9001)
- Redis message queue (port 6379)

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your configuration
```

### 3. Setup Database

```bash
cd backend
cargo install sqlx-cli
sqlx database create
sqlx migrate run
```

### 4. Build and Run Backend

```bash
cd backend
cargo build --release
cargo run
```

Backend will be available at `http://localhost:8080`

### 5. Build Agent

```bash
cd agent
cargo build --release
```

### 6. Run Dashboard

```bash
cd dashboard
npm install
npm run dev
```

Dashboard will be available at `http://localhost:3000`

## Project Structure

```
RAV/
├── agent/              # Cross-platform endpoint agent
├── backend/            # Backend API server
├── dashboard/          # Web dashboard
├── shared/             # Shared types and protocols
├── docker-compose.yml  # Development infrastructure
└── plan.md            # Implementation plan and progress
```

## Development

### Running Tests

```bash
# Agent tests
cd agent && cargo test

# Backend tests
cd backend && cargo test
```

### Database Migrations

```bash
cd backend
sqlx migrate add <migration_name>
sqlx migrate run
```

## Security

- All communications use TLS 1.3
- Evidence stored with AES-256-GCM encryption
- SHA-256 hashing for all files
- Tamper detection and integrity checks
- Full audit logging

## License

Proprietary - See license agreement

## Support

For issues and questions, please contact the development team.

