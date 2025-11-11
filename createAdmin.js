// createAdmin.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/user');

mongoose.connect('mongodb://127.0.0.1:27017/WapdaPortal');

const createAdmin = async () => {
  const hashed = await bcrypt.hash('admin123', 10);
  const admin = await User.create({
    name: 'Admin',
    email: 'admin@wapda.com',
    password: hashed,
    role: 'admin',
  });
  console.log('Admin created:', admin.email);
  process.exit();
};

createAdmin();