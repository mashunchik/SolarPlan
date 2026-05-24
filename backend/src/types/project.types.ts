export type CreateProjectRequestBody = {
  name: string;
  formData: Record<string, unknown>;
  solutions: unknown[];
  recommendedSolutionId: string;
};

export type Project = {
  id: string;
  name: string;
  formData: Record<string, unknown>;
  solutions: unknown[];
  recommendedSolutionId: string;
  createdAt: Date;
};
