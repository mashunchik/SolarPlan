import fs from 'fs/promises';
import path from 'path';

import { pool } from '../config/db';

const initDatabase = async (): Promise<void> => {
  const sqlFilePath = path.join(__dirname, 'init.sql');

  try {
    const sql = await fs.readFile(sqlFilePath, 'utf-8');

    await pool.query(sql);
    console.log('Database tables initialized successfully');
  } catch (error: unknown) {
    console.error('Database initialization failed', error);
  } finally {
    await pool.end();
  }
};

void initDatabase();
