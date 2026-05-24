import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

import { config } from '../config/env';
import { AuthTokenPayload } from '../types/auth.types';

const sendUnauthorized = (res: Response): void => {
  res.status(401).json({
    message: 'Не авторизовано',
  });
};

export const authMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const authorizationHeader = req.headers.authorization;

  if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
    sendUnauthorized(res);
    return;
  }

  const token = authorizationHeader.slice(7).trim();

  if (!token) {
    sendUnauthorized(res);
    return;
  }

  try {
    const decodedToken = jwt.verify(token, config.jwtSecret);

    if (
      typeof decodedToken !== 'object' ||
      !decodedToken ||
      typeof decodedToken.userId !== 'string' ||
      typeof decodedToken.email !== 'string'
    ) {
      sendUnauthorized(res);
      return;
    }

    req.user = {
      userId: decodedToken.userId,
      email: decodedToken.email,
    } satisfies AuthTokenPayload;

    next();
  } catch {
    sendUnauthorized(res);
  }
};
