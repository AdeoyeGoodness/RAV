# Build Stage
# Build Stage
FROM rust:latest as builder

WORKDIR /usr/src/rav_backend
COPY . .

# Build release binary
RUN cargo build --release

# Runtime Stage
FROM debian:bullseye-slim

WORKDIR /app

# Install runtime dependencies (OpenSSL, etc.)
RUN apt-get update && apt-get install -y libssl1.1 ca-certificates && rm -rf /var/lib/apt/lists/*

# Copy binary from builder
COPY --from=builder /usr/src/rav_backend/target/release/rav_backend /app/rav_backend

# Copy migrations folder if needed (assuming sqlx or similar embedded, but good practice if separate)
# COPY --from=builder /usr/src/rav_backend/migrations /app/migrations

EXPOSE 8080

CMD ["./rav_backend"]
