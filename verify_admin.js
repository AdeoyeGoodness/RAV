const http = require('http');

async function request(path, method, body = null, token = null) {
    const data = body ? JSON.stringify(body) : '';
    const options = {
        hostname: 'localhost',
        port: 8080,
        path: path,
        method: method,
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length
        }
    };
    if (token) {
        options.headers['Authorization'] = `Bearer ${token}`;
    }

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
    console.log('--- Step 1: Login ---');
    const loginRes = await request('/api/v1/auth/login', 'POST', {
        email: 'admin@rav.local',
        password: 'rav-super-password'
    });
    console.log('Login Status:', loginRes.status);
    if (loginRes.status !== 200) {
        console.error('Login Failed:', loginRes.body);
        return;
    }
    const { token } = JSON.parse(loginRes.body);
    console.log('Token received');

    console.log('\n--- Step 2: List Organizations ---');
    const listRes = await request('/api/v1/admin/organizations', 'GET', null, token);
    console.log('List Status:', listRes.status);
    console.log('Organizations:', listRes.body);

    console.log('\n--- Step 3: Create Organization ---');
    const createRes = await request('/api/v1/admin/organizations', 'POST', {
        name: 'Test Enterprise Corp',
        license_key: 'test-license-123'
    }, token);
    console.log('Create Status:', createRes.status);
    console.log('Created Org:', createRes.body);

    console.log('\n--- Step 4: List Organizations Again ---');
    const listRes2 = await request('/api/v1/admin/organizations', 'GET', null, token);
    console.log('List Status:', listRes2.status);
    console.log('Organizations Count:', JSON.parse(listRes2.body).length);
}

run().catch(console.error);
