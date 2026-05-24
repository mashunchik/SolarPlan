import { Router } from 'express';

import { getDatabaseHealth, getHealth } from '../controllers/health.controller';

const router = Router();

router.get('/health', getHealth);
router.get('/health/db', getDatabaseHealth);

export default router;
