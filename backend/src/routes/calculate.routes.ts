import { Router } from 'express';

import { calculate } from '../controllers/calculate.controller';

const router = Router();

router.post('/calculate', calculate);

export default router;