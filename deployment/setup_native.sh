#!/bin/bash
set -e

# Configuration
DOMAIN_NAME=${DOMAIN_NAME:-"rav.handy.boats"}
DB_PASSWORD=${DB_PASSWORD:-"rav_password"}
REDIS_PASSWORD=${REDIS_PASSWORD:-""}

echo "🚀 Starting Native (No-Docker) Deployment for $DOMAIN_NAME..."

# 1. System Updates & Dependencies
echo "📦 Installing system dependencies..."
apt-get update
apt-get install -y curl git build-essential postgresql postgresql-contrib redis-server libssl-dev pkg-config

# 2. Install Node.js (v18)
if ! command -v node &> /dev/null; then
    echo "📦 Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
fi

# 3. Install Rust
if ! command -v cargo &> /dev/null; then
    echo "📦 Installing Rust..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
fi

# 4. Install PM2
echo "📦 Installing PM2..."
npm install -g pm2

# 5. Setup Postgres
echo "🐘 Configuring Postgres..."
service postgresql start
sudo -u postgres psql -c "CREATE USER rav_user WITH PASSWORD '$DB_PASSWORD';" || true
sudo -u postgres psql -c "CREATE DATABASE rav_db OWNER rav_user;" || true

# 6. Setup Minio (Local Binary)
echo "🪣 Installing Minio..."
if [ ! -f /usr/local/bin/minio ]; then
    wget https://dl.min.io/server/minio/release/linux-amd64/minio
    chmod +x minio
    mv minio /usr/local/bin/
fi
# Create Minio data dir
mkdir -p /root/data
# Start Minio with PM2 if not running
pm2 start "minio server /root/data --console-address :9001" --name rav-minio || true

# 7. Configure Environment Variables (Needed for Build)
echo "📝 Writing environment configuration..."
cat > ../backend/.env <<EOF
HOST=0.0.0.0
PORT=8080
DATABASE_URL=postgres://rav_user:$DB_PASSWORD@localhost:5432/rav_db
REDIS_URL=redis://localhost:6379
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=rav-evidence
JWT_SECRET=production_secret_key_change_me
cors_allowed_origins=https://$DOMAIN_NAME
EOF

# 8. Build Backend
echo "🦀 Building Backend (Release)..."
cd ../backend
source "$HOME/.cargo/env"

# Install sqlx-cli for migrations
if ! command -v sqlx &> /dev/null; then
    echo "🛠️ Installing sqlx-cli..."
    cargo install sqlx-cli --no-default-features --features postgres
fi

# Configure Env for Build & Migrations
export DATABASE_URL="postgres://rav_user:$DB_PASSWORD@localhost:5432/rav_db"

# Run Migrations (Create Tables)
echo "🔄 Running Database Migrations..."
sqlx migrate run

# Build
echo "🏗️ Compiling Rust Binary..."
cargo build --release
cd ../deployment

# 9. Build Dashboard
echo "⚛️ Building Dashboard..."
cd ../dashboard
npm ci
# Fix missing public folder specific to this user's issue
mkdir -p public
echo "# Public" > public/.gitkeep
# Create .env.production
echo "NEXT_PUBLIC_API_URL=https://$DOMAIN_NAME" > .env.production
npm run build
cd ../deployment

# 10. Start Services with PM2
echo "🔥 Starting Applications with PM2..."
pm2 start ecosystem.config.js
pm2 save

# 11. Install & Configure Caddy
echo "🔒 Installing Caddy..."
if ! command -v caddy &> /dev/null; then
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
    apt-get update
    apt-get install -y caddy
fi

# Update Caddyfile
sed -i "s/\${DOMAIN_NAME}/$DOMAIN_NAME/g" Caddyfile
# Replace Caddyfile
cp Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy

echo "✅ Bare Metal Deployment Complete!"
echo "Dashboard: https://$DOMAIN_NAME"
