import { randomUUID } from 'crypto';

import { pool } from '../config/db';
import { CreateProjectRequestBody, Project } from '../types/project.types';

type ProjectRow = {
  id: string;
  user_id: string;
  name: string;
  form_data: Record<string, unknown>;
  solutions: unknown[];
  recommended_solution_id: string;
  created_at: Date;
};

const mapProjectRow = (projectRow: ProjectRow): Project => ({
  id: projectRow.id,
  name: projectRow.name,
  formData: projectRow.form_data,
  solutions: projectRow.solutions,
  recommendedSolutionId: projectRow.recommended_solution_id,
  createdAt: projectRow.created_at,
});

export const getProjectsForUser = async (userId: string): Promise<Project[]> => {
  const getProjectsQuery = `
    SELECT id, user_id, name, form_data, solutions, recommended_solution_id, created_at
    FROM projects
    WHERE user_id = $1
    ORDER BY created_at DESC
  `;
  const result = await pool.query<ProjectRow>(getProjectsQuery, [userId]);

  return result.rows.map(mapProjectRow);
};

export const getProjectForUserById = async (
  projectId: string,
  userId: string,
): Promise<Project | null> => {
  const getProjectQuery = `
    SELECT id, user_id, name, form_data, solutions, recommended_solution_id, created_at
    FROM projects
    WHERE id = $1 AND user_id = $2
    LIMIT 1
  `;
  const result = await pool.query<ProjectRow>(getProjectQuery, [projectId, userId]);
  const project = result.rows[0];

  return project ? mapProjectRow(project) : null;
};

export const createProjectForUser = async (
  userId: string,
  projectData: CreateProjectRequestBody,
): Promise<Project> => {
  const projectId = randomUUID();
  const serializedFormData = JSON.stringify(projectData.formData);
  const serializedSolutions = JSON.stringify(projectData.solutions);

  console.log('createProjectForUser payload', {
    formDataType: typeof projectData.formData,
    solutionsIsArray: Array.isArray(projectData.solutions),
    firstSolutionType: typeof projectData.solutions[0],
    firstSolution: projectData.solutions[0] ?? null,
  });

  const insertProjectQuery = `
    INSERT INTO projects (id, user_id, name, form_data, solutions, recommended_solution_id)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, user_id, name, form_data, solutions, recommended_solution_id, created_at
  `;
  const result = await pool.query<ProjectRow>(insertProjectQuery, [
    projectId,
    userId,
    projectData.name.trim(),
    serializedFormData,
    serializedSolutions,
    projectData.recommendedSolutionId.trim(),
  ]);

  return mapProjectRow(result.rows[0]);
};

export const deleteProjectForUser = async (
  projectId: string,
  userId: string,
): Promise<boolean> => {
  const deleteProjectQuery = `
    DELETE FROM projects
    WHERE id = $1 AND user_id = $2
    RETURNING id
  `;
  const result = await pool.query<{ id: string }>(deleteProjectQuery, [projectId, userId]);

  return Boolean(result.rows[0]);
};