const readline = require('readline');
const http = require('http');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

console.log("\n👤 --- Create RAV Admin User ---\n");

const ask = (question) => new Promise((resolve) => rl.question(question, resolve));

async function main() {
    try {
        const email = await ask("Enter Admin Email: ");
        const password = await ask("Enter Password: ");
        const fullName = await ask("Enter Full Name: ");
        const orgName = await ask("Enter Organization Name: ");

        console.log("\nCreating user...");

        const data = JSON.stringify({
            email,
            password,
            full_name: fullName,
            organization_name: orgName
        });

        const options = {
            hostname: '127.0.0.1',
            port: 8080,
            path: '/api/auth/register',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    console.log("\n✅ Admin user created successfully!");
                    console.log(`\n👉 Login at: https://${process.env.DOMAIN_NAME || 'YOUR_VPS_IP'}/login`);
                } else {
                    console.error(`\n❌ Failed to create user (Status: ${res.statusCode})`);
                    console.error("Response:", body);
                    if (res.statusCode === 409) {
                        console.error("Reason: User or Organization already exists.");
                    }
                }
                rl.close();
            });
        });

        req.on('error', (error) => {
            console.error("\n❌ Error sending request:", error.message);
            console.error("Make sure the backend is running! (pm2 status)");
            rl.close();
        });

        req.write(data);
        req.end();

    } catch (error) {
        console.error("An error occurred:", error);
        rl.close();
    }
}

main();
