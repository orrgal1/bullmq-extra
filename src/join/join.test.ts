import { v4 } from 'uuid';
import { default as IORedis } from 'ioredis';
import { delay, Queue } from 'bullmq';
import { GenericContainer, Wait } from 'testcontainers';
import { Join } from './join';

jest.setTimeout(60000);

describe('join', function () {
  let generalConnection: IORedis;
  beforeAll(async function () {
    const redisContainerSetup = new GenericContainer('redis:7.4.0')
      .withExposedPorts(6379)
      .withWaitStrategy(
        Wait.forLogMessage(/.*Ready to accept connections tcp.*/, 1),
      );
    const redisContainer = await redisContainerSetup.start();
    const mappedPort = redisContainer.getMappedPort(6379);
    generalConnection = new IORedis({
      port: mappedPort,
      maxRetriesPerRequest: null,
    });
  });

  describe('when completing within timeout', () => {
    it('should send complete result', async () => {
      const joinName = `test-${v4()}`;
      const target = new Queue(`test-${v4()}`, {
        connection: generalConnection,
      });
      const sources = [
        {
          queue: new Queue(`test-${v4()}`, {
            connection: generalConnection,
          }),
          getJoinKey: (data) => data.joinKey,
        },
        {
          queue: new Queue(`test-${v4()}`, {
            connection: generalConnection,
          }),
          getJoinKey: (data) => data.joinKey,
        },
      ];

      const join = new Join({
        joinName,
        onComplete: (data) => {
          const sum = data.reduce((acc, val) => {
            return acc + val.val.value;
          }, 0);
          return { sum };
        },
        redis: generalConnection,
        sources: sources.map((source) => ({
          queue: source.queue.name,
          getJoinKey: source.getJoinKey,
        })),
        target,
        timeout: 10000,
      });
      join.run();

      const jobs = 10;

      for (let i = 1; i <= jobs; i++) {
        for (const source of sources) {
          await source.queue.add('test', { joinKey: i, value: i });
        }
      }

      while ((await target.count()) < jobs) {
        await delay(50);
      }

      expect(await target.count()).toEqual(jobs);
      const waiting = await target.getWaiting();
      expect(
        waiting.map((job) => job.data).sort((a, b) => a.sum - b.sum),
      ).toEqual(
        Array.from(Array(jobs).keys())
          .map((i) => ({
            sum: (i + 1) * 2,
          }))
          .sort((a, b) => a.sum - b.sum),
      );
    });
  });

  describe('when not completing within timeout', () => {
    it('should send partial result', async () => {
      const joinName = `test-${v4()}`;
      const target = new Queue(`test-${v4()}`, {
        connection: generalConnection,
      });
      const sources = [
        {
          queue: new Queue(`test-${v4()}`, {
            connection: generalConnection,
          }),
          getJoinKey: (data) => data.joinKey,
        },
        {
          queue: new Queue(`test-${v4()}`, {
            connection: generalConnection,
          }),
          getJoinKey: (data) => data.joinKey,
        },
      ];

      const join = new Join({
        joinName,
        onComplete: (data) => {
          const sum = data.reduce((acc, val) => {
            return acc + val.val.value;
          }, 0);
          return { sum };
        },
        redis: generalConnection,
        sources: sources.map((source) => ({
          queue: source.queue.name,
          getJoinKey: source.getJoinKey,
        })),
        target,
        timeout: 10,
      });
      join.run();

      const jobs = 10;

      for (let i = 1; i <= jobs; i++) {
        await sources[0].queue.add('test', { joinKey: i, value: i });
      }

      while ((await target.count()) < jobs) {
        await delay(50);
      }

      expect(await target.count()).toEqual(jobs);
      const waiting = await target.getWaiting();
      expect(
        waiting.map((job) => job.data).sort((a, b) => a.sum - b.sum),
      ).toEqual(
        Array.from(Array(jobs).keys())
          .map((i) => ({
            sum: i + 1,
          }))
          .sort((a, b) => a.sum - b.sum),
      );
    });
  });

  describe('when only 1 source', () => {
    it('should send complete result', async () => {
      const joinName = `test-${v4()}`;
      const target = new Queue(`test-${v4()}`, {
        connection: generalConnection,
      });
      const sources = [
        {
          queue: new Queue(`test-${v4()}`, {
            connection: generalConnection,
          }),
          getJoinKey: (data) => data.joinKey,
        },
      ];

      const join = new Join({
        joinName,
        onComplete: (data) => {
          const sum = data.reduce((acc, val) => {
            return acc + val.val.value;
          }, 0);
          return { sum };
        },
        redis: generalConnection,
        sources: sources.map((source) => ({
          queue: source.queue.name,
          getJoinKey: source.getJoinKey,
        })),
        target,
        timeout: 10000,
      });
      join.run();

      const jobs = 10;

      for (let i = 1; i <= jobs; i++) {
        for (const source of sources) {
          await source.queue.add('test', { joinKey: i, value: i });
        }
      }

      while ((await target.count()) < jobs) {
        await delay(50);
      }

      expect(await target.count()).toEqual(jobs);
      const waiting = await target.getWaiting();
      expect(
        waiting.map((job) => job.data).sort((a, b) => a.sum - b.sum),
      ).toEqual(
        Array.from(Array(jobs).keys())
          .map((i) => ({
            sum: i + 1,
          }))
          .sort((a, b) => a.sum - b.sum),
      );
    });
  });
});