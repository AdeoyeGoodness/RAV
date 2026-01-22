# RAV Browser Monitor - Privacy Policy

**Last Updated:** January 22, 2026

## Introduction

RAV Browser Monitor ("the Extension") is an enterprise browser monitoring extension developed by RAV Security ("we," "us," or "our"). This Privacy Policy explains how we collect, use, and protect information when you use our Extension.

**Important:** This Extension is designed exclusively for enterprise deployment by IT administrators. It is not intended for individual consumer use.

---

## Information We Collect

The Extension collects the following types of information:

### 1. Browsing History
- URLs of websites visited
- Page titles
- Visit timestamps
- Visit frequency

### 2. Active Tabs
- Currently open tab URLs
- Tab titles
- Tab state (active/inactive)

### 3. Downloads
- Downloaded file names
- Download URLs
- File sizes
- Download timestamps
- Download status (completed, interrupted, etc.)

### 4. Technical Information
- Browser type and version
- Extension version
- Connection status

---

## How We Collect Information

All data is collected through official Chrome/Edge browser APIs:
- `chrome.history` API for browsing history
- `chrome.tabs` API for active tab information
- `chrome.downloads` API for download activity

Data is transmitted securely via Chrome's Native Messaging protocol to a locally installed endpoint agent, which then syncs with your organization's designated backend server over encrypted HTTPS connections.

---

## How We Use Information

The collected information is used exclusively for:

1. **Enterprise Security Monitoring** - Detecting potential security threats and policy violations
2. **Compliance Auditing** - Meeting regulatory and internal compliance requirements
3. **IT Asset Management** - Understanding software usage patterns
4. **Insider Threat Detection** - Identifying unusual or risky behavior patterns
5. **Incident Investigation** - Supporting forensic analysis when security incidents occur

---

## Data Sharing

We do **NOT**:
- Sell your data to third parties
- Share data with advertisers
- Use data for marketing purposes
- Share data outside your organization

Data is shared **ONLY** with:
- Your organization's IT/Security administrators
- Your organization's designated RAV platform instance
- Law enforcement when legally required

---

## Data Storage and Security

- All data transmission uses TLS 1.2+ encryption
- Data is stored on your organization's designated servers
- Access is restricted to authorized administrators only
- Data retention is controlled by your organization's policies

---

## Enterprise Deployment

This Extension is deployed and managed by your organization's IT department. By using devices managed by your organization, you acknowledge that:

- Your employer has authorized monitoring of work-related browser activity
- Your IT administrator controls the Extension's installation and configuration
- Data collected is owned by your organization
- Your organization's acceptable use policies apply

---

## Your Rights

Depending on your jurisdiction, you may have rights regarding your personal data. Please contact your organization's IT department or Data Protection Officer for:

- Access to your collected data
- Correction of inaccurate data
- Deletion requests (subject to retention requirements)
- Information about data processing

---

## Children's Privacy

This Extension is not intended for use by individuals under 18 years of age. It is designed for enterprise workplace environments only.

---

## Changes to This Policy

We may update this Privacy Policy periodically. Changes will be reflected in the "Last Updated" date above. Continued use of the Extension after changes constitutes acceptance of the updated policy.

---

## Contact Information

For questions about this Privacy Policy or data practices:

**RAV Security**
- Email: privacy@ravsecurity.com
- Website: https://ravsecurity.com/privacy

For organization-specific data inquiries, contact your IT administrator.

---

## Permissions Justification

| Permission | Purpose |
|------------|---------|
| `tabs` | Monitor active browser tabs for security visibility |
| `history` | Collect browsing history for compliance and threat detection |
| `downloads` | Track file downloads to detect data exfiltration |
| `storage` | Store extension configuration locally |
| `alarms` | Schedule periodic data collection intervals |
| `nativeMessaging` | Securely communicate with the local RAV agent |

---

*This Extension is intended for lawful enterprise monitoring purposes only. Organizations deploying this Extension are responsible for ensuring compliance with applicable privacy laws and providing appropriate notice to end users.*
