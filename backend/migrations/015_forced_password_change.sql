-- Migration 015: Forced Password Change Flow

-- Add to users table
ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN password_changed_at TIMESTAMPTZ;

-- Add to organizations table  
ALTER TABLE organizations ADD COLUMN admin_verified BOOLEAN NOT NULL DEFAULT false;
