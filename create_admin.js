const https = require('http');

const data = JSON.stringify({
    email: 'admin@rav.local',
    password: 'rav-super-password',
    role: 'super_admin',
    full_name: 'RAV Super Admin',
    organization_id: null
});

const options = {
    hostname: 'localhost',
    port: 8080,
    path: '/api/v1/auth/register',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
    }
};

const req = https.request(options, (res) => {
    let responseData = '';
    res.on('data', (chunk) => {
        responseData += chunk;
    });
    res.on('end', () => {
        console.log('Status Code:', res.statusCode);
        console.log('Body:', responseData);
    });
});

req.on('error', (error) => {
    console.error('Error:', error);
});

req.write(data);
req.end();
