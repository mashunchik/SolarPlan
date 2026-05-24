import { NextFunction, Request, RequestHandler, Response } from 'express';

import {
  createProjectForUser,
  deleteProjectForUser,
  getProjectForUserById,
  getProjectsForUser,
} from '../services/project.service';
import type { AuthTokenPayload } from '../types/auth.types';
import type { CreateProjectRequestBody } from '../types/project.types';

const createHttpError = (message: string, statusCode: number): Error & { statusCode: number } => {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;

  return error;
};

const getRequiredUser = (req: Request): AuthTokenPayload => {
  if (!req.user) {
    throw createHttpError('Не авторизовано', 401);
  }

  return req.user;
};

export const getProjects: RequestHandler = async (
  req,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const user = getRequiredUser(req);
    const projects = await getProjectsForUser(user.userId);

    res.status(200).json({
      projects,
    });
  } catch (error: unknown) {
    next(error);
  }
};

export const createProject: RequestHandler<Record<string, string>, unknown, CreateProjectRequestBody> = async (
  req,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const user = getRequiredUser(req);
    const { name, formData, solutions, recommendedSolutionId } = req.body;

    if (!name?.trim()) {
      throw createHttpError("Назва проєкту є обов'язковою", 400);
    }

    if (!formData || typeof formData !== 'object' || Array.isArray(formData)) {
      throw createHttpError('formData є обов\'язковим', 400);
    }

    if (!Array.isArray(solutions)) {
      throw createHttpError('solutions є обов\'язковим масивом', 400);
    }

    if (!recommendedSolutionId?.trim()) {
      throw createHttpError('recommendedSolutionId є обов\'язковим', 400);
    }

    const project = await createProjectForUser(user.userId, {
      name,
      formData,
      solutions,
      recommendedSolutionId,
    });

    res.status(201).json({
      message: 'Проєкт успішно збережено',
      project,
    });
  } catch (error: unknown) {
    next(error);
  }
};

export const getProjectById: RequestHandler<{ id: string }> = async (
  req,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const user = getRequiredUser(req);
    const project = await getProjectForUserById(req.params.id, user.userId);

    if (!project) {
      throw createHttpError('Проєкт не знайдено', 404);
    }

    res.status(200).json({
      project,
    });
  } catch (error: unknown) {
    next(error);
  }
};

export const deleteProject: RequestHandler<{ id: string }> = async (
  req,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const user = getRequiredUser(req);
    const isDeleted = await deleteProjectForUser(req.params.id, user.userId);

    if (!isDeleted) {
      throw createHttpError('Проєкт не знайдено', 404);
    }

    res.status(200).json({
      message: 'Проєкт успішно видалено',
    });
  } catch (error: unknown) {
    next(error);
  }
};

