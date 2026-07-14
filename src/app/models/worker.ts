export interface WorkerRequest<T = unknown> {
  id: number;
  payload: T;
}

export interface WorkerResponse<T = unknown> {
  id: number;
  result?: T;
  error?: string;
}