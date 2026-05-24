import { Request, Response } from 'express';

import { testDbConnection } from '../config/db';

export const getHealth = (_req: Request, res: Response): void => {
  res.status(200).json({
    status: 'ok',
  });
};

export const getDatabaseHealth = async (_req: Request, res: Response): Promise<void> => {
  try {
    await testDbConnection();

    res.status(200).json({
      status: 'ok',
      database: 'connected',
    });
  } catch {
    res.status(500).json({
      status: 'error',
      database: 'disconnected',
    });
  }
};
