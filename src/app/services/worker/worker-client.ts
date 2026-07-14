import { WorkerRequest, WorkerResponse } from '../../models/worker';

export class TypedWorkerClient<TRequest, TResponse> {
  private worker: Worker;
  private nextId = 0;
  private pending = new Map<number, {
    resolve: (value: TResponse) => void;
    reject: (reason: unknown) => void;
  }>();

  constructor(workerFactory: () => Worker) {
    this.worker = workerFactory();

    this.worker.onmessage = ({ data }: MessageEvent<WorkerResponse<TResponse>>) => {
      const entry = this.pending.get(data.id);
      if (!entry) return;
      this.pending.delete(data.id);

      if (data.error) {
        entry.reject(new Error(data.error));
      } else {
        entry.resolve(data.result as TResponse);
      }
    };

    this.worker.onerror = (event) => {
      for (const entry of this.pending.values()) {
        entry.reject(event);
      }
      this.pending.clear();
    };
  }

  postMessage(payload: TRequest): Promise<TResponse> {
    const id = this.nextId++;
    return new Promise<TResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const message: WorkerRequest<TRequest> = { id, payload };
      this.worker.postMessage(message);
    });
  }

  terminate(): void {
    this.worker.terminate();
    for (const entry of this.pending.values()) {
      entry.reject(new Error('Worker terminated'));
    }
    this.pending.clear();
  }
}