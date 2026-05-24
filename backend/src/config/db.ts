import { Pool } from 'pg';

import { config } from './env';

export const pool = new Pool({
  connectionString: config.databaseUrl,
});

export const testDbConnection = async (): Promise<void> => {
  const client = await pool.connect();

  try {
    await client.query('SELECT NOW()');
  } finally {
    client.release();
  }
};
