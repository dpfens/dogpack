import { WorkerRequest, WorkerResponse } from "../models/worker";

export function handleWorkerMessages<TRequest, TResponse>(
  handler: (payload: TRequest) => TResponse | Promise<TResponse>
): void {
  addEventListener('message', async ({ data }: MessageEvent<WorkerRequest<TRequest>>) => {
    try {
      const result = await handler(data.payload);
      postMessage({ id: data.id, result } satisfies WorkerResponse<TResponse>);
    } catch (err) {
      postMessage({
        id: data.id,
        error: err instanceof Error ? err.message : String(err),
      } satisfies WorkerResponse<TResponse>);
    }
  });
}