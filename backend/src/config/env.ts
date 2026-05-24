import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: Number(process.env.PORT) || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl:
    process.env.DATABASE_URL ||
    'postgresql://postgres:your_password@localhost:5432/solar_planner',
  jwtSecret: process.env.JWT_SECRET || 'change_me',
};
