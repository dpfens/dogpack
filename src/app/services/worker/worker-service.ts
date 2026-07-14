// worker.service.ts
import { Injectable } from '@angular/core';
import { TypedWorkerClient } from './worker-client';

@Injectable({ providedIn: 'root' })
export class WorkerService {
  readonly isSupported = typeof Worker !== 'undefined';

  create<TRequest, TResponse>(
    workerFactory: () => Worker
  ): TypedWorkerClient<TRequest, TResponse> {
    if (!this.isSupported) {
      throw new Error('Web Workers are not supported in this environment.');
    }
    return new TypedWorkerClient<TRequest, TResponse>(workerFactory);
  }
}