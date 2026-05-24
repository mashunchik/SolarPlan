import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';

import { config } from '../config/env';
import { pool } from '../config/db';
import {
  LoginRequestBody,
  LoginResult,
  PublicUser,
  RegisterRequestBody,
} from '../types/auth.types';

type UserLookupRow = {
  id: string;
};

type AuthUserRow = {
  id: string;
  name: string;
  email: string;
  password_hash: string;
};

type DatabaseError = Error & {
  code?: string;
};

const createHttpError = (message: string, statusCode: number): Error & { statusCode: number } => {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;

  return error;
};

export const registerUser = async ({
  name,
  email,
  password,
}: RegisterRequestBody): Promise<PublicUser> => {
  const normalizedName = name.trim();
  const normalizedEmail = email.trim().toLowerCase();

  const existingUserResult = await pool.query<UserLookupRow>(
    'SELECT id FROM users WHERE email = $1 LIMIT 1',
    [normalizedEmail],
  );

  if (existingUserResult.rowCount && existingUserResult.rowCount > 0) {
    throw createHttpError('Користувач з таким email уже існує', 409);
  }

  const userId = randomUUID();
  const passwordHash = await bcrypt.hash(password, 10);
  const insertUserQuery = `
    INSERT INTO users (id, name, email, password_hash)
    VALUES ($1, $2, $3, $4)
    RETURNING id, name, email
  `;

  try {
    const insertUserResult = await pool.query<PublicUser>(insertUserQuery, [
      userId,
      normalizedName,
      normalizedEmail,
      passwordHash,
    ]);

    const createdUser = insertUserResult.rows[0];

    if (!createdUser) {
      throw createHttpError('Не вдалося зареєструвати користувача', 500);
    }

    return createdUser;
  } catch (error: unknown) {
    const databaseError = error as DatabaseError;

    if (databaseError.code === '23505') {
      throw createHttpError('Користувач з таким email уже існує', 409);
    }

    throw error;
  }
};

export const loginUser = async ({ email, password }: LoginRequestBody): Promise<LoginResult> => {
  const normalizedEmail = email.trim().toLowerCase();
  const findUserQuery = `
    SELECT id, name, email, password_hash
    FROM users
    WHERE email = $1
    LIMIT 1
  `;
  const userResult = await pool.query<AuthUserRow>(findUserQuery, [normalizedEmail]);
  const existingUser = userResult.rows[0];

  if (!existingUser) {
    throw createHttpError('Невірний email або пароль', 401);
  }

  const isPasswordValid = await bcrypt.compare(password, existingUser.password_hash);

  if (!isPasswordValid) {
    throw createHttpError('Невірний email або пароль', 401);
  }

  const token = jwt.sign(
    {
      userId: existingUser.id,
      email: existingUser.email,
    },
    config.jwtSecret,
    {
      expiresIn: '7d',
    },
  );

  return {
    token,
    user: {
      id: existingUser.id,
      name: existingUser.name,
      email: existingUser.email,
    },
  };
};

export const getCurrentUser = async (userId: string): Promise<PublicUser | null> => {
  const findCurrentUserQuery = `
    SELECT id, name, email
    FROM users
    WHERE id = $1
    LIMIT 1
  `;
  const userResult = await pool.query<PublicUser>(findCurrentUserQuery, [userId]);

  return userResult.rows[0] ?? null;
};
