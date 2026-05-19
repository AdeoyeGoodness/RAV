const bcrypt = require('bcryptjs');

const hash = '$2b$12$YAXdCRnrDnEEYtWgNjvje.kCza5d7LuVMiWIcEdl2sxS2jv7mES2e';
const pass = 'Sentinelrav2234@';

bcrypt.compare(pass, hash).then(res => console.log('Match:', res));
