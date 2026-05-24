import { Router } from 'express';

import {
  createProject,
  deleteProject,
  getProjectById,
  getProjects,
} from '../controllers/project.controller';
import { authMiddleware } from '../middleware/auth-middleware';

const router = Router();

router.use(authMiddleware);

router.get('/', getProjects);
router.post('/', createProject);
router.get('/:id', getProjectById);
router.delete('/:id', deleteProject);

export default router;
