import { NextFunction, RequestHandler } from 'express';

import { getCurrentUser, loginUser, registerUser } from '../services/auth.service';
import { LoginRequestBody, RegisterRequestBody } from '../types/auth.types';

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const createHttpError = (message: string, statusCode: number): Error & { statusCode: number } => {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;

  return error;
};

export const register: RequestHandler<Record<string, string>, unknown, RegisterRequestBody> = async (
  req,
  res,
  next: NextFunction,
): Promise<void> => {
  try {
    const { name, email, password } = req.body;

    if (!name?.trim()) {
      throw createHttpError("Ім'я є обов'язковим", 400);
    }

    if (!email?.trim()) {
      throw createHttpError('Email є обов\'язковим', 400);
    }

    if (!emailRegex.test(email.trim())) {
      throw createHttpError('Некоректний email', 400);
    }

    if (!password) {
      throw createHttpError('Пароль є обов\'язковим', 400);
    }

    if (password.length < 6) {
      throw createHttpError('Пароль має містити щонайменше 6 символів', 400);
    }

    const user = await registerUser({ name, email, password });

    res.status(201).json({
      message: 'Користувача успішно зареєстровано',
      user,
    });
  } catch (error: unknown) {
    next(error);
  }
};

export const login: RequestHandler<Record<string, string>, unknown, LoginRequestBody> = async (
  req,
  res,
  next: NextFunction,
): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email?.trim()) {
      throw createHttpError('Email є обов\'язковим', 400);
    }

    if (!emailRegex.test(email.trim())) {
      throw createHttpError('Некоректний email', 400);
    }

    if (!password) {
      throw createHttpError('Пароль є обов\'язковим', 400);
    }

    const { token, user } = await loginUser({ email, password });

    res.status(200).json({
      message: 'Вхід виконано успішно',
      token,
      user,
    });
  } catch (error: unknown) {
    next(error);
  }
};

export const getMe: RequestHandler = async (req, res, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) {
      throw createHttpError('Не авторизовано', 401);
    }

    const user = await getCurrentUser(req.user.userId);

    if (!user) {
      throw createHttpError('Користувача не знайдено', 404);
    }

    res.status(200).json({
      user,
    });
  } catch (error: unknown) {
    next(error);
  }
};

