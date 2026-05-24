import { NextFunction, Request, Response } from 'express';

import { calculateProject } from '../services/solarCalculation.service';
import type { CalculateRequestBody } from '../types/calculate.types';

export const calculate = async (
  req: Request<unknown, unknown, CalculateRequestBody>,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.body?.formData) {
      res.status(400).json({
        message: 'Дані розрахунку не передані',
      });
      return;
    }

    const result = await calculateProject(req.body.formData);

    res.status(200).json(result);
  } catch (error: unknown) {
    next(error);
  }
};