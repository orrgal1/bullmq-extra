import { v4 } from 'uuid';
import { default as IORedis } from 'ioredis';
import { delay, Queue } from 'bullmq';
import { Consumer } from './consumer';
import { Producer } from './producer';
import { Fanout } from './fanout';
import * as _debug from 'debug';

const debug = _debug('bullmq:fanout:test');

jest.setTimeout(10000);

describe('fanout', function () {
  let consumerConnection: IORedis;
  let generalConnection: IORedis;
  beforeAll(async function () {
    consumerConnection = new IORedis({ maxRetriesPerRequest: null });
    generalConnection = new IORedis({ maxRetriesPerRequest: null });
  });

  describe('produce-consume', () => {
    describe('when consuming', () => {
      it('should trim to retention', async () => {
        const streamName = `test-${v4()}`;
        const consumerGroup = `test-${v4()}`;
        const producer = new Producer(streamName, {
          connection: generalConnection,
        });
        const consumer = new Consumer(streamName, {
          connection: consumerConnection,
          maxRetentionMs: 100,
          trimIntervalMs: 100,
        });
        const jobs = 10;
        const processed: any[] = [];
        consumer.consume(consumerGroup, async (job) => {
          processed.push(job);
        });

        for (let iterations = 0; iterations < 5; iterations++) {
          for (let i = 1; i <= jobs; i++) {
            await producer.produce({ idx: i });
          }
          const length = await consumer.getLength();
          expect(length).toBeLessThanOrEqual(jobs * 2); // trimming is not exact but it does happen
          await delay(1000);
        }

        await consumer.close();
      });
    });

    describe('when jobs produced with an active consumer', () => {
      it('should process the jobs', async () => {
        const streamName = `test-${v4()}`;
        const consumerGroup = `test-${v4()}`;
        const producer = new Producer(streamName, {
          connection: generalConnection,
        });
        const consumer = new Consumer(streamName, {
          connection: consumerConnection,
        });
        const jobs = 10;
        const processed: any[] = [];
        consumer.consume(consumerGroup, async (job) => {
          processed.push(job);
        });

        for (let i = 1; i <= jobs; i++) {
          await producer.produce({ idx: i });
        }
        while (processed.length < jobs) {
          await delay(50);
        }
        expect(processed.length).toEqual(jobs);
        expect(processed.map((job) => job.idx)).toEqual(
          Array.from(Array(jobs).keys()).map((i) => i + 1),
        );
        await consumer.close();
      });
    });

    describe('when jobs produced with a late consumer', () => {
      it('should process the jobs', async () => {
        const streamName = `test-${v4()}`;
        const consumerGroup = `test-${v4()}`;
        const producer = new Producer(streamName, {
          connection: generalConnection,
        });
        const consumer = new Consumer(streamName, {
          connection: consumerConnection,
        });
        const jobs = 10;
        const processed: any[] = [];

        for (let i = 1; i <= jobs / 2; i++) {
          await producer.produce({ idx: i });
        }
        consumer.consume(consumerGroup, async (job) => {
          processed.push(job);
        });
        for (let i = jobs / 2 + 1; i <= jobs; i++) {
          await producer.produce({ idx: i });
        }
        while (processed.length < jobs) {
          await delay(50);
        }
        expect(processed.length).toEqual(jobs);
        expect(processed.map((job) => job.idx)).toEqual(
          Array.from(Array(jobs).keys()).map((i) => i + 1),
        );
        await consumer.close();
      });
    });
  });

  describe('fanout', () => {
    describe('when jobs produced with an active fanout', () => {
      it('should fanout to defined queues', async () => {
        const group = `test-${v4()}`;
        const queueName = `test-${v4()}`;
        const sourceQueue = new Queue(queueName, {
          connection: generalConnection,
        });
        const fanout = new Fanout(queueName, {
          connection: consumerConnection,
        });
        const targetQueues = [
          new Queue(`test-${v4()}`, { connection: generalConnection }),
          new Queue(`test-${v4()}`, { connection: generalConnection }),
        ];
        const jobs = 10;

        fanout.fanout(group, targetQueues).then();

        for (let i = 1; i <= jobs; i++) {
          await sourceQueue.add('default', { idx: i });
        }
        while ((await targetQueues[1].count()) < jobs) {
          await delay(50);
        }
        debug('test.targetQueues.done');
        for (const queue of targetQueues) {
          expect(await queue.count()).toEqual(jobs);
          expect((await queue.getWaiting()).map((job) => job.data.idx)).toEqual(
            Array.from(Array(jobs).keys()).map((i) => i + 1),
          );
        }
        debug('test.expect.done');
        await fanout.close();
        debug('test.done');
      });
    });

    describe('when jobs produced with job options', () => {
      it('should set options on target jobs', async () => {
        const group = `test-${v4()}`;
        const queueName = `test-${v4()}`;
        const sourceQueue = new Queue(queueName, {
          connection: generalConnection,
        });
        const fanout = new Fanout(queueName, {
          connection: consumerConnection,
        });
        const targetQueues = [
          new Queue(`test-${v4()}`, { connection: generalConnection }),
          new Queue(`test-${v4()}`, { connection: generalConnection }),
        ];
        const jobs = 10;

        fanout.fanout(group, targetQueues).then();

        for (let i = 1; i <= jobs; i++) {
          await sourceQueue.add('default', { idx: i }, { jobId: `test-${i}` });
        }
        while ((await targetQueues[1].count()) < jobs) {
          await delay(50);
        }
        for (const queue of targetQueues) {
          expect(await queue.count()).toEqual(jobs);
          expect((await queue.getWaiting()).map((job) => job.opts)).toEqual(
            Array.from(Array(jobs).keys()).map((i) => ({
              jobId: `test-${i + 1}`,
              attempts: 0,
              backoff: undefined,
            })),
          );
        }
        await fanout.close();
      });

      it('should override options on target jobs', async () => {
        const group = `test-${v4()}`;
        const queueName = `test-${v4()}`;
        const sourceQueue = new Queue(queueName, {
          connection: generalConnection,
        });
        const fanout = new Fanout(queueName, {
          connection: consumerConnection,
        });
        const targetQueues = [
          new Queue(`test-${v4()}`, { connection: generalConnection }),
          new Queue(`test-${v4()}`, { connection: generalConnection }),
        ];
        const jobs = 10;

        fanout
          .fanout(group, targetQueues, (data: any) => ({
            jobId: `test-${data.idx + 10}`,
          }))
          .then();

        for (let i = 1; i <= jobs; i++) {
          await sourceQueue.add('default', { idx: i });
        }
        while ((await targetQueues[1].count()) < jobs) {
          await delay(50);
        }
        for (const queue of targetQueues) {
          expect(await queue.count()).toEqual(jobs);
          expect((await queue.getWaiting()).map((job) => job.opts)).toEqual(
            Array.from(Array(jobs).keys()).map((i) => ({
              jobId: `test-${i + 1 + 10}`,
              attempts: 0,
              backoff: undefined,
            })),
          );
        }
        await fanout.close();
      });
    });

    describe('when jobs produced with a late fanout', () => {
      it('should fanout to defined queues', async () => {
        const group = `test-${v4()}`;
        const queueName = `test-${v4()}`;
        const sourceQueue = new Queue(queueName, {
          connection: generalConnection,
        });
        const fanout = new Fanout(queueName, {
          connection: consumerConnection,
        });
        const targetQueues = [
          new Queue(`test-${v4()}`, { connection: generalConnection }),
          new Queue(`test-${v4()}`, { connection: generalConnection }),
        ];
        const jobs = 10;

        for (let i = 1; i <= jobs / 2; i++) {
          await sourceQueue.add('default', { idx: i });
        }

        fanout.fanout(group, targetQueues).then().catch(console.error);

        for (let i = jobs / 2 + 1; i <= jobs; i++) {
          await sourceQueue.add('default', { idx: i });
        }

        while ((await targetQueues[1].count()) < jobs) {
          await delay(50);
        }
        for (const queue of targetQueues) {
          expect(await queue.count()).toEqual(jobs);
          expect((await queue.getWaiting()).map((job) => job.data.idx)).toEqual(
            Array.from(Array(jobs).keys()).map((i) => i + 1),
          );
        }
        await fanout.close();
      });
    });

    describe('when fanout is stopped and restarted', () => {
      it('should not consume acked messages', async () => {
        const group = `test-${v4()}`;
        const queueName = `test-${v4()}`;
        const sourceQueue = new Queue(queueName, {
          connection: generalConnection,
        });
        const fanout = new Fanout(queueName, {
          connection: consumerConnection,
        });
        const targetQueues = [
          new Queue(`test-${v4()}`, { connection: generalConnection }),
          new Queue(`test-${v4()}`, { connection: generalConnection }),
        ];
        const laterFanout = new Fanout(queueName, {
          connection: consumerConnection,
        });
        const jobs = 10;

        fanout.fanout(group, targetQueues).then().catch(console.error);

        for (let i = 1; i <= jobs; i++) {
          await sourceQueue.add('default', { idx: i });
        }

        while ((await targetQueues[1].count()) < jobs) {
          await delay(50);
        }
        await fanout.close();

        laterFanout.fanout(group, targetQueues).then().catch(console.error);

        for (const queue of targetQueues) {
          await queue.clean(0, 1000, 'wait');
        }

        for (let i = 1; i <= jobs; i++) {
          await sourceQueue.add('default', { idx: i + 20 });
        }

        while ((await targetQueues[1].count()) < jobs) {
          await delay(50);
        }

        for (const queue of targetQueues) {
          expect(await queue.count()).toEqual(jobs);
          expect((await queue.getWaiting()).map((job) => job.data.idx)).toEqual(
            Array.from(Array(jobs).keys()).map((i) => i + 1 + 20),
          );
        }
        await laterFanout.close();
      });
    });
  });
});
