import { User } from '../models/user.model.js';
import { UserRole } from '../constants/index.js';
import { connectDB, disconnectDB } from '../config/db.js';

export const initialUsersData = [
  {
    email: 'admin@dndgaming.com',
    password: 'AdminPassword123!',
    fullName: 'Lounge Administrator',
    role: UserRole.ADMIN,
    phoneNumber: '+91 98765 43210'
  },
  {
    email: 'staff@dndgaming.com',
    password: 'StaffPassword123!',
    fullName: 'Lounge Duty Staff',
    role: UserRole.STAFF,
    phoneNumber: '+91 98765 43211'
  },
  {
    email: 'customer@dndgaming.com',
    password: 'CustomerPassword123!',
    fullName: 'Rahul Sharma',
    role: UserRole.CUSTOMER,
    phoneNumber: '+91 98765 43212'
  }
];

export async function seedUsers() {
  console.log('🌱 Seeding initial user accounts...');
  for (const item of initialUsersData) {
    const existing = await User.findOne({ email: item.email });
    if (!existing) {
      const passwordHash = await User.hashPassword(item.password);
      await User.create({
        email: item.email,
        passwordHash,
        fullName: item.fullName,
        role: item.role,
        phoneNumber: item.phoneNumber,
        isActive: true
      });
      console.log(`👤 Created user: ${item.email} [${item.role}]`);
    } else {
      console.log(`⏩ User ${item.email} already exists, skipping.`);
    }
  }
  const count = await User.countDocuments();
  console.log(`✅ Total users in database: ${count}`);
}

// Allow direct CLI execution: node src/seeds/seedUsers.js
if (process.argv[1]?.endsWith('seedUsers.js')) {
  (async () => {
    try {
      await connectDB();
      await seedUsers();
      await disconnectDB();
      process.exit(0);
    } catch (error) {
      console.error('❌ User seeding failed:', error);
      process.exit(1);
    }
  })();
}
