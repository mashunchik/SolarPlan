import app from './app';
import { testDbConnection } from './config/db';
import { config } from './config/env';

app.listen(config.port, () => {
  console.log(`Server is running on port ${config.port}`);
});

void testDbConnection()
  .then(() => {
    console.log('PostgreSQL connection successful');
  })
  .catch((error: unknown) => {
    console.error('PostgreSQL connection failed', error);
  });
