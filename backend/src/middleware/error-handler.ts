import { NextFunction, Request, Response } from 'express';

type ErrorWithStatus = Error & {
  statusCode?: number;
};

export const errorHandler = (
  err: ErrorWithStatus,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  const statusCode = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
  const isDevelopment = process.env.NODE_ENV === 'development';
  const safeMessage =
    statusCode < 500 && err.message
      ? err.message
      : isDevelopment && err.message
        ? err.message
        : 'Internal server error';

  if (isDevelopment) {
    console.error(err);
  }

  res.status(statusCode).json({
    message: safeMessage,
  });
};
