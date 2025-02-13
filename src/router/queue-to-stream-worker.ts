import { Job, Worker, WorkerOptions } from 'bullmq';
import { Producer } from './producer';
import * as _debug from 'debug';

const debug = _debug('bullmq:router:queue-to-stream-worker');

export class QueueToStreamWorker extends Worker {
  constructor(name: string, streamName: string, opts?: WorkerOptions) {
    const producer = new Producer(streamName, {
      connection: undefined,
      ...opts,
    });
    const processor = async (job: Job) => {
      await producer.produce(job.data, job.opts);
      debug('produce', job.data, job.opts);
    };
    super(name, processor, opts);
  }
}
