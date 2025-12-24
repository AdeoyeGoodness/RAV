module.exports = {
    apps: [
        {
            name: 'rav-dashboard',
            cwd: '../dashboard',
            script: 'npm',
            args: 'start',
            env: {
                PORT: 3000,
                NODE_ENV: 'production'
            }
        },
        {
            name: 'rav-backend',
            cwd: '../backend',
            script: './target/release/rav_backend',
            env: {
                PORT: 8080,
                HOST: '0.0.0.0'
            }
        }
    ]
}
