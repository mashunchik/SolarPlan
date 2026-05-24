import cors from 'cors';
import express from 'express';

import { errorHandler } from './middleware/error-handler';
import { notFoundHandler } from './middleware/not-found-handler';
import authRoutes from './routes/auth.routes';
import calculateRoutes from './routes/calculate.routes';
import healthRoutes from './routes/health.routes';
import projectRoutes from './routes/project.routes';

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api', healthRoutes);
app.use('/api', calculateRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;