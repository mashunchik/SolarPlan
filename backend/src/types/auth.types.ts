import type { Request } from 'express';

export type RegisterRequestBody = {
  name: string;
  email: string;
  password: string;
};

export type LoginRequestBody = {
  email: string;
  password: string;
};

export type PublicUser = {
  id: string;
  name: string;
  email: string;
};

export type LoginResult = {
  token: string;
  user: PublicUser;
};

export type AuthTokenPayload = {
  userId: string;
  email: string;
};

export type AuthenticatedRequest = Request & {
  user?: AuthTokenPayload;
};
