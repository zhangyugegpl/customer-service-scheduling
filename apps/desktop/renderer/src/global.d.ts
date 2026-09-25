import type { SchedulerApi } from '../../../../packages/contracts/types';

declare global {
  interface Window {
    schedulerApi: SchedulerApi;
  }
}

export {};
