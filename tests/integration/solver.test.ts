import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SchedulingService } from '../../packages/application/schedulingService';
import { createDefaultConfig } from '../../packages/contracts/defaultConfig';
import { SolverClient } from '../../packages/solver-client/client';

const projectRoot = path.resolve('.');
const client = new SolverClient({ packaged: false, resourcesPath: '', projectRoot });

describe('OR-Tools 求解器集成', () => {
  it('健康检查返回求解器版本', async () => {
    const health = await client.health();
    expect(health.ok).toBe(true);
    expect(health.solverVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('默认配置可生成完整排班并通过 H1～H9 校验', async () => {
    const service = new SchedulingService(client);
    const result = await service.generate({
      config: createDefaultConfig(),
      targetMonth: '2026-10',
      timeLimitSeconds: 8,
      randomSeed: 7,
    });
    expect(['PUBLISHABLE', 'EXCEPTION']).toContain(result.status);
    expect(result.assignments).toHaveLength(9 * 31);
    expect(result.issues.filter((value) => value.severity === 'ERROR')).toHaveLength(0);
  }, 20_000);

  it('配置预检查错误时不启动排班搜索', async () => {
    const config = createDefaultConfig();
    config.positions[0]!.defaultMinQuota = 30;
    const service = new SchedulingService(client);
    const result = await service.generate({ config, targetMonth: '2026-10' });
    expect(result.status).toBe('INFEASIBLE');
    expect(result.metrics.status).toBe('PRECHECK_FAILED');
  });
});
