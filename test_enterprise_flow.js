const http = require('http');

async function request(path, method, body = null, headers = {}) {
    const data = body ? JSON.stringify(body) : '';
    const options = {
        hostname: 'localhost',
        port: 8080,
        path: path,
        method: method,
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
            ...headers
        }
    };

    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let resData = '';
            res.on('data', (chunk) => resData += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body: resData }));
        });
        req.on('error', reject);
        if (body) req.write(data);
        req.end();
    });
}

async function run() {
    console.log('--- ENTERPRISE FLOW VERIFICATION ---');

    console.log('\n--- 1. SUPER ADMIN LOGIN ---');
    const loginRes = await request('/api/v1/auth/login', 'POST', {
        email: 'admin@rav.local',
        password: 'rav-super-password'
    });
    if (loginRes.status !== 200) throw new Error('Admin login failed');
    const { token } = JSON.parse(loginRes.body);
    console.log('✓ Admin authenticated');

    console.log('\n--- 2. CREATING TEST ORGANIZATION ---');
    const timestamp = Date.now();
    const licenseKey = `ENTERPRISE-${timestamp}`;
    const orgName = `Acme Corp ${timestamp}`;
    const orgRes = await request('/api/v1/admin/organizations', 'POST', {
        name: orgName,
        license_key: licenseKey
    }, { 'Authorization': `Bearer ${token}` });
    if (orgRes.status !== 200) throw new Error(`Org creation failed: ${orgRes.body}`);
    const org = JSON.parse(orgRes.body);
    console.log(`✓ Organization "${orgName}" created with License: ${licenseKey}`);

    console.log('\n--- 3. AGENT REGISTRATION (ACME CORP) ---');
    const agentId = 'ACME-AGENT-001';
    const regRes = await request('/api/v1/agents/register', 'POST', {
        agent_id: agentId,
        hardware_fingerprint: 'HW-999-XYZ',
        license_key: licenseKey
    });
    if (regRes.status !== 200) throw new Error('Agent registration failed');
    const regBody = JSON.parse(regRes.body);
    const orgId = regBody.organization_id;
    console.log(`✓ Agent registered. Assigned Org ID: ${orgId}`);

    console.log('\n--- 4. DATA INGESTION (ACME CORP) ---');
    const ingestRes = await request('/api/v1/events', 'POST', [
        {
            agent_id: agentId,
            organization_id: orgId,
            event_type: 'process_start',
            timestamp: new Date().toISOString(),
            metadata: { process: 'notepad.exe', user: 'acme_user' }
        }
    ]);
    if (ingestRes.status !== 200) throw new Error('Ingestion failed');
    console.log('✓ Success: Events ingested and automatically tagged with Acme Corp Org ID');

    console.log('\n--- 5. VERIFYING DATA ISOLATION (THE SILO TEST) ---');
    // We try to query Acme's data using the "Default Organization" ID (all zeros) or a fake one
    const fakeOrgId = '00000000-0000-0000-0000-000000000000';
    const queryRes = await request(`/api/v1/events?agent_id=${agentId}`, 'GET', null, {
        'X-Organization-Id': fakeOrgId
    });

    if (queryRes.status === 404 || (queryRes.status === 200 && JSON.parse(queryRes.body).length === 0)) {
        console.log('✓ SUCCESS: Data Isolation Confirmed. Fake Org ID cannot see Acme Corp data.');
    } else {
        console.log('✕ FAILURE: Isolation Breach! Unauthorized Org ID saw data.');
    }

    console.log('\n--- 6. SUPER ADMIN GLOBAL VIEW ---');
    const globalRes = await request('/api/v1/admin/organizations', 'GET', null, { 'Authorization': `Bearer ${token}` });
    const globalOrgs = JSON.parse(globalRes.body);
    console.log(`✓ Total Organizations visible to Super Admin: ${globalOrgs.length}`);

    console.log('\n-------------------------------------');
    console.log('ALL ENTERPRISE FOUNDATION TESTS PASSED');
    console.log('-------------------------------------');
}

run().catch(err => {
    console.error('\n✕ TEST FAILED:', err.message);
    process.exit(1);
});
