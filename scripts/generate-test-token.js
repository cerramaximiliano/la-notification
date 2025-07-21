const jwt = require('jsonwebtoken');
require('dotenv').config();

// Test user data
const testUser = {
    id: '5f1f10d45b860e5a18acb7a2', // julieta.bombora@gmail.com
    email: 'julieta.bombora@gmail.com',
    role: 'USER_ROLE'
};

// Generate token
const token = jwt.sign(testUser, process.env.JWT_SECRET || process.env.SEED, {
    expiresIn: '7d'
});

console.log('Generated test token for WebSocket authentication:\n');
console.log(token);
console.log('\nUser details:');
console.log(testUser);
console.log('\nCopy this token and paste it in the client example.');